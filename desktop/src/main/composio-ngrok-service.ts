import { ChildProcess, spawn } from 'child_process'
import type { ComposioNgrokStatus } from '../shared/composio-types'

const NGROK_PUBLIC_URL_RE = /https:\/\/[a-zA-Z0-9.-]+\.ngrok(?:-free)?\.app\b/g

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shellCommandForNgrok(port: number): { shell: string; args: string[] } {
  const shell = process.env.SHELL?.trim() || (process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh')
  if (process.platform === 'win32') {
    return { shell, args: ['/d', '/s', '/c', `ngrok http http://127.0.0.1:${port} --log=stdout`] }
  }
  return { shell, args: ['-lc', `exec ngrok http http://127.0.0.1:${port} --log=stdout`] }
}

function normalizePublicUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function publicUrlFromUnknown(value: unknown, localPort: number): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const tunnels = Array.isArray(record.tunnels) ? record.tunnels : []
  for (const tunnel of tunnels) {
    if (!tunnel || typeof tunnel !== 'object') continue
    const t = tunnel as Record<string, unknown>
    const publicUrl = typeof t.public_url === 'string' ? t.public_url : ''
    if (!publicUrl.startsWith('https://')) continue
    const config = t.config && typeof t.config === 'object' ? t.config as Record<string, unknown> : null
    const addr = typeof config?.addr === 'string' ? config.addr : ''
    if (!addr || addr.includes(`:${localPort}`) || addr.endsWith(String(localPort))) {
      return normalizePublicUrl(publicUrl)
    }
  }
  return null
}

async function readNgrokApi(localPort: number): Promise<string | null> {
  try {
    const response = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return null
    return publicUrlFromUnknown(await response.json(), localPort)
  } catch {
    return null
  }
}

class ComposioNgrokService {
  private process: ChildProcess | null = null
  private localPort: number | null = null
  private publicUrl: string | null = null
  private startedAt: number | null = null
  private lastError: string | null = null
  private starting: Promise<ComposioNgrokStatus> | null = null

  getStatus(): ComposioNgrokStatus {
    return {
      running: Boolean((this.process && !this.process.killed) || this.publicUrl),
      publicUrl: this.publicUrl ?? undefined,
      localPort: this.localPort ?? undefined,
      startedAt: this.startedAt ?? undefined,
      lastError: this.lastError ?? undefined,
    }
  }

  async start(localPort: number): Promise<ComposioNgrokStatus> {
    if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
      throw new Error('Invalid ngrok local port')
    }

    const existingUrl = await readNgrokApi(localPort)
    if (existingUrl) {
      this.publicUrl = existingUrl
      this.localPort = localPort
      this.startedAt = this.startedAt ?? Date.now()
      this.lastError = null
      return this.getStatus()
    }

    if (this.process && !this.process.killed) {
      if (this.localPort === localPort && this.publicUrl) return this.getStatus()
      this.stop()
    }

    if (this.starting) return this.starting

    this.starting = this.startProcess(localPort).finally(() => {
      this.starting = null
    })
    return this.starting
  }

  stop(): ComposioNgrokStatus {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM')
    }
    this.process = null
    this.publicUrl = null
    this.localPort = null
    this.startedAt = null
    this.lastError = null
    return this.getStatus()
  }

  private async startProcess(localPort: number): Promise<ComposioNgrokStatus> {
    const { shell, args } = shellCommandForNgrok(localPort)
    this.localPort = localPort
    this.publicUrl = null
    this.startedAt = Date.now()
    this.lastError = null

    const child = spawn(shell, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
    })
    this.process = child

    let output = ''
    const capture = (chunk: Buffer | string) => {
      const text = String(chunk)
      output = (output + text).slice(-6000)
      const match = text.match(NGROK_PUBLIC_URL_RE) || output.match(NGROK_PUBLIC_URL_RE)
      if (match?.[0]) {
        this.publicUrl = normalizePublicUrl(match[0])
        this.lastError = null
      }
    }

    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)

    child.on('error', (err) => {
      this.lastError = err.message
      if (this.process === child) this.process = null
    })
    child.on('exit', (code, signal) => {
      if (this.process === child) this.process = null
      if (!this.publicUrl) {
        this.lastError = output.trim() || `ngrok exited${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}`
      }
    })

    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (this.publicUrl) return this.getStatus()
      const apiUrl = await readNgrokApi(localPort)
      if (apiUrl) {
        this.publicUrl = apiUrl
        this.lastError = null
        return this.getStatus()
      }
      if (child.exitCode !== null) break
      await sleep(500)
    }

    const message = this.lastError || output.trim() || 'ngrok did not report a public HTTPS URL within 12 seconds.'
    if (!this.publicUrl) {
      this.stop()
      this.lastError = message
      throw new Error(message)
    }
    return this.getStatus()
  }
}

export const composioNgrokService = new ComposioNgrokService()
