import { createServer, type IncomingMessage, type Server } from 'http'
import type { ComposioWebhookSettings } from '../shared/composio-types'
import { DEFAULT_COMPOSIO_WEBHOOK_SETTINGS } from '../shared/composio-types'
import { emitAutomationEvent } from './automation-event-bus'
import {
  mergeDedupeKeyForGithubPr,
  shouldEmitMergeDedupeKey,
} from './automation-merge-dedupe'
import { listPersistedProjectsWithBranches } from './persisted-state'
import {
  prInfoFromExtracted,
  tryExtractGithubPrMergeFromComposioBody,
} from './composio-payload'
import { getGithubRepoForRepoPath } from './composio-repo-resolve'

function normalizePath(p: string): string {
  const t = (p || '/').trim()
  if (!t.startsWith('/')) return `/${t}`
  return t.replace(/\/+$/, '') || '/'
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > maxBytes) {
        reject(new Error('payload too large'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function extractSecret(req: IncomingMessage, configured: string): boolean {
  if (!configured) return true
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const q = url.searchParams.get('secret')
  if (q && q === configured) return true

  const h = req.headers['x-constellagent-webhook-secret'] ?? req.headers['x-webhook-secret']
  if (typeof h === 'string' && h === configured) return true
  if (Array.isArray(h) && h[0] === configured) return true
  return false
}

function normalizeWebhookSettings(raw: unknown): ComposioWebhookSettings {
  if (!isRecord(raw)) return { ...DEFAULT_COMPOSIO_WEBHOOK_SETTINGS }

  return {
    enabled: Boolean(raw.enabled),
    port:
      typeof raw.port === 'number' && Number.isFinite(raw.port) && raw.port > 0 && raw.port < 65536
        ? Math.floor(raw.port)
        : DEFAULT_COMPOSIO_WEBHOOK_SETTINGS.port,
    path:
      typeof raw.path === 'string' && raw.path.startsWith('/')
        ? raw.path
        : DEFAULT_COMPOSIO_WEBHOOK_SETTINGS.path,
    sharedSecret: typeof raw.sharedSecret === 'string' ? raw.sharedSecret : '',
    bindAllInterfaces: Boolean(raw.bindAllInterfaces),
    publicBaseUrl: typeof raw.publicBaseUrl === 'string' ? raw.publicBaseUrl.trim().replace(/\/+$/, '') : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
  }
}

export class ComposioWebhookService {
  private server: Server | null = null
  private effectivePort = 0
  private lastError: string | undefined
  private settings: ComposioWebhookSettings = { ...DEFAULT_COMPOSIO_WEBHOOK_SETTINGS }
  private deliveryHandler: ((payload: unknown) => Promise<number>) | null = null
  /** Avoid stop/start churn when persisted state or Settings re-applies identical receiver options. */
  private lastListenFingerprint: string | null = null

  setDeliveryHandler(handler: ((payload: unknown) => Promise<number>) | null): void {
    this.deliveryHandler = handler
  }

  getSettings(): ComposioWebhookSettings {
    return { ...this.settings }
  }

  getStatus(): { listening: boolean; port: number; lastError?: string } {
    return {
      listening: Boolean(this.server?.listening),
      port: this.effectivePort,
      lastError: this.lastError,
    }
  }

  /** Apply from persisted app state root object (full or partial). */
  applyFromPersistedState(data: unknown): void {
    this.settings = normalizeWebhookSettings(isRecord(data) ? data.composioWebhook : undefined)
    void this.restart().catch((err) => console.error('[composio-webhook] restart failed', err))
  }

  /** Apply renderer settings immediately and wait until the receiver has restarted. */
  async applySettings(settings: unknown): Promise<void> {
    this.settings = normalizeWebhookSettings(settings)
    await this.restart()
  }

  private fingerprintForListen(): string {
    return JSON.stringify({
      enabled: this.settings.enabled,
      port: this.settings.port,
      path: normalizePath(this.settings.path),
      bindAllInterfaces: this.settings.bindAllInterfaces,
      secretLen: this.settings.sharedSecret.length,
    })
  }

  async restart(): Promise<void> {
    const fp = this.fingerprintForListen()

    if (!this.settings.enabled) {
      await this.stop()
      this.lastListenFingerprint = fp
      this.lastError = undefined
      return
    }

    if (this.server?.listening && this.lastListenFingerprint === fp) {
      return
    }

    await this.stop()
    this.lastError = undefined

    const path = normalizePath(this.settings.path)
    const bind = this.settings.bindAllInterfaces ? '0.0.0.0' : '127.0.0.1'
    const port = this.settings.port

    const server = createServer(async (req, res) => {
      try {
        const u = new URL(req.url ?? '/', `http://${bind}`)
        if (normalizePath(u.pathname) !== path) {
          res.writeHead(404).end()
          return
        }

        const method = req.method ?? 'GET'
        const allow = 'POST, GET, HEAD, OPTIONS'

        if (method === 'OPTIONS') {
          res.writeHead(204, { Allow: allow }).end()
          return
        }

        // Browsers and tunnel UIs often probe with GET; Composio delivers with POST.
        if (method === 'GET' || method === 'HEAD') {
          if (!extractSecret(req, this.settings.sharedSecret)) {
            res.writeHead(401).end('Unauthorized')
            return
          }
          if (method === 'HEAD') {
            res.writeHead(200, { Allow: allow }).end()
            return
          }
          res
            .writeHead(200, { 'Content-Type': 'application/json', Allow: allow })
            .end(
              JSON.stringify({
                ok: true,
                hint: 'Constellagent Composio webhook — use POST with a JSON body for trigger deliveries.',
              }),
            )
          return
        }

        if (method !== 'POST') {
          res.writeHead(405, { Allow: allow }).end()
          return
        }

        if (!extractSecret(req, this.settings.sharedSecret)) {
          res.writeHead(401).end('Unauthorized')
          return
        }
        let raw: unknown
        try {
          const text = await readBody(req, 512 * 1024)
          raw = text ? JSON.parse(text) : {}
        } catch {
          res.writeHead(400).end('Bad Request')
          return
        }

        let routedCount = 0
        if (this.deliveryHandler) {
          try {
            routedCount = await this.deliveryHandler(raw)
          } catch (err) {
            console.error('[composio-webhook] delivery router failed', err)
          }
        }

        const extracted = tryExtractGithubPrMergeFromComposioBody(raw)
        if (!extracted) {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, routed: routedCount }))
          return
        }

        const fullName = `${extracted.owner}/${extracted.repo}`
        const projectId = this.findProjectIdForGithubRepo(fullName)
        if (!projectId) {
          console.warn('[composio-webhook] no local project for repo', fullName)
          res.writeHead(200).end('{}')
          return
        }

        const dedupeKey = mergeDedupeKeyForGithubPr(fullName, extracted.pullRequest.number)
        if (!shouldEmitMergeDedupeKey(dedupeKey)) {
          res.writeHead(200).end('{"deduped":true}')
          return
        }

        const prInfo = prInfoFromExtracted(extracted)
        console.info('[composio-webhook] emitting pr:merged', {
          projectId,
          repo: fullName,
          pr: extracted.pullRequest.number,
          branch: extracted.headBranch,
        })
        emitAutomationEvent({
          type: 'pr:merged',
          timestamp: Date.now(),
          projectId,
          branch: extracted.headBranch,
          prInfo,
          meta: { automationOrigin: 'composio-webhook' },
        })

        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, routed: routedCount }))
      } catch (err) {
        console.error('[composio-webhook]', err)
        res.writeHead(500).end()
      }
    })

    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, bind, () => {
        const addr = server.address()
        this.effectivePort = addr && typeof addr === 'object' ? addr.port : port
        this.lastListenFingerprint = fp
        console.info(`[composio-webhook] listening on http://${bind}:${this.effectivePort}${path}`)
        resolve()
      })
    }).catch((err: unknown) => {
      this.lastError = err instanceof Error ? err.message : String(err)
      console.error('[composio-webhook] failed to listen', err)
      this.server = null
      this.effectivePort = 0
    })
  }

  async stop(): Promise<void> {
    const s = this.server
    this.server = null
    this.effectivePort = 0
    if (!s) return
    await new Promise<void>((resolve) => {
      s.close(() => resolve())
    }).catch(() => {})
  }

  private findProjectIdForGithubRepo(fullName: string): string | null {
    const target = fullName.toLowerCase()
    for (const p of listPersistedProjectsWithBranches()) {
      const info = getGithubRepoForRepoPath(p.repoPath)
      if (!info) continue
      if (`${info.owner}/${info.name}`.toLowerCase() === target) {
        return p.projectId
      }
    }
    return null
  }
}

export const composioWebhookService = new ComposioWebhookService()
