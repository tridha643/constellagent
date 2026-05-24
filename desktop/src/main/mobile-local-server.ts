import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { URL } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  createMobileCommandRequestSchema,
  mobileAccessStatusSchema,
  type CreateMobileCommandRequest,
  type MobileAccessStatus,
  type MobileCommand,
  type MobileCommandType,
  type MobileEvent,
  type MobileWorkspaceSummary,
} from '@constellagent/mobile-protocol'
import { listPersistedMobileWorkspaces } from './persisted-state'
import { MobileStore } from './mobile-store'

const DEFAULT_PORT = 3987

interface MobileLocalServerOptions {
  readonly enabled?: boolean
  readonly host?: string
  readonly port?: number
  readonly token?: string
}

interface AuthResult {
  readonly ok: boolean
  readonly deviceId: string
}

export class MobileLocalServer {
  private readonly store: MobileStore
  private readonly enabled: boolean
  private readonly configuredHost?: string
  private readonly configuredPort: number
  private readonly token?: string
  private server: Server | null = null
  private wsServer: WebSocketServer | null = null
  private sockets = new Set<WebSocket>()
  private runningHost = ''
  private runningPort = 0

  constructor(options: MobileLocalServerOptions = {}) {
    this.store = new MobileStore()
    this.enabled = options.enabled ?? process.env.CONSTELLAGENT_MOBILE_ACCESS === '1'
    this.configuredHost = options.host ?? process.env.CONSTELLAGENT_MOBILE_HOST
    this.configuredPort = options.port ?? parsePort(process.env.CONSTELLAGENT_MOBILE_PORT)
    this.token = options.token ?? process.env.CONSTELLAGENT_MOBILE_TOKEN
  }

  async start(): Promise<void> {
    if (!this.enabled || this.server) return
    const host = this.configuredHost || detectTailscaleAddress() || '127.0.0.1'
    const port = this.configuredPort
    await new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handleRequest(req, res).catch((error) => {
          console.error('[mobile] request failed', error)
          writeJson(res, 500, { error: 'Internal server error' })
        })
      })
      server.on('error', reject)
      server.listen(port, host, () => {
        this.server = server
        this.runningHost = host
        this.runningPort = resolveAddressPort(server.address(), port)
        this.attachWebSocketServer(server)
        console.info('[mobile] local server listening', this.getStatus())
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.close(1001, 'Server stopping')
    }
    this.sockets.clear()
    this.wsServer?.close()
    this.wsServer = null
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close(() => resolve())
    })
    this.server = null
    this.runningHost = ''
    this.runningPort = 0
    await this.store.close()
  }

  getStatus(): MobileAccessStatus {
    const tailscaleAddresses = listTailscaleAddresses()
    const host = this.runningHost || this.configuredHost || tailscaleAddresses[0] || '127.0.0.1'
    const port = this.runningPort || this.configuredPort
    const baseUrl = port > 0 ? `http://${host}:${port}` : ''
    return mobileAccessStatusSchema.parse({
      enabled: this.enabled,
      running: this.server !== null,
      host,
      port,
      baseUrl,
      tailscale: {
        available: tailscaleAddresses.length > 0,
        addresses: tailscaleAddresses,
      },
    })
  }

  async publishEvent(input: Parameters<MobileStore['appendEvent']>[0]): Promise<MobileEvent> {
    const event = await this.store.appendEvent(input)
    const message = JSON.stringify({ type: 'event', event })
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(message)
    }
    return event
  }

  private attachWebSocketServer(server: Server): void {
    const wsServer = new WebSocketServer({ noServer: true })
    this.wsServer = wsServer
    server.on('upgrade', (req, socket, head) => {
      const url = parseRequestUrl(req)
      if (!url || url.pathname !== '/ws') {
        socket.destroy()
        return
      }
      const auth = this.authenticate(req, url)
      if (!auth.ok) {
        socket.destroy()
        return
      }
      wsServer.handleUpgrade(req, socket, head, (ws) => {
        this.sockets.add(ws)
        ws.send(JSON.stringify({ type: 'hello', status: this.getStatus() }))
        ws.on('close', () => this.sockets.delete(ws))
      })
    })
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = parseRequestUrl(req)
    if (!url) {
      writeJson(res, 400, { error: 'Invalid URL' })
      return
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      writeJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'GET' && url.pathname === '/mobile/status') {
      writeJson(res, 200, this.getStatus())
      return
    }

    const auth = this.authenticate(req, url)
    if (!auth.ok) {
      writeJson(res, 401, { error: 'Mobile access token required', code: 'unauthorized' })
      return
    }

    if (req.method === 'GET' && url.pathname === '/workspaces') {
      const workspaces: MobileWorkspaceSummary[] = listPersistedMobileWorkspaces()
      writeJson(res, 200, { workspaces })
      return
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      const since = Number.parseInt(url.searchParams.get('since') ?? '0', 10)
      const events = await this.store.listEvents(Number.isFinite(since) ? since : 0)
      writeJson(res, 200, { events })
      return
    }

    if (req.method === 'POST' && url.pathname === '/commands') {
      const raw = await readBody(req)
      const parsed = createMobileCommandRequestSchema.safeParse(JSON.parse(raw || '{}'))
      if (!parsed.success) {
        writeJson(res, 400, { error: 'Invalid command request', code: 'invalid_command' })
        return
      }
      const command = await this.createCommand(auth.deviceId, parsed.data)
      writeJson(res, command.status === 'rejected' ? 403 : 202, { command })
      return
    }

    writeJson(res, 404, { error: 'Not found' })
  }

  private async createCommand(
    deviceId: string,
    request: CreateMobileCommandRequest,
  ): Promise<MobileCommand> {
    const policy = evaluateCommandPolicy(request.type)
    const command = await this.store.createCommand({
      deviceId,
      type: request.type,
      payload: request.payload,
      policyResult: policy.allowed ? 'allowed' : 'blocked',
      status: policy.allowed ? 'pending' : 'rejected',
      ...(policy.reason ? { error: policy.reason } : {}),
    })
    if (!policy.allowed) {
      await this.publishEvent({
        type: 'command.rejected',
        payload: { commandId: command.id, commandType: request.type, reason: policy.reason },
      })
    }
    return command
  }

  private authenticate(req: IncomingMessage, url: URL): AuthResult {
    if (!this.token) return { ok: false, deviceId: '' }
    const header = req.headers.authorization
    const bearer = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : ''
    const queryToken = url.searchParams.get('token') ?? ''
    if (bearer === this.token || queryToken === this.token) {
      return { ok: true, deviceId: 'env-token-device' }
    }
    return { ok: false, deviceId: '' }
  }
}

function evaluateCommandPolicy(type: MobileCommandType): { allowed: boolean; reason?: string } {
  switch (type) {
    case 'session.reply':
    case 'session.cancel':
    case 'plan.approve':
    case 'plan.reject':
    case 'annotation.create':
    case 'annotation.resolve':
      return { allowed: true }
    default:
      return { allowed: false, reason: 'Unsupported mobile command type' }
  }
}

function parsePort(raw: string | undefined): number {
  if (!raw) return DEFAULT_PORT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return DEFAULT_PORT
  return parsed
}

function parseRequestUrl(req: IncomingMessage): URL | null {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1')
  } catch {
    return null
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function writeJson(res: ServerResponse, statusCode: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function resolveAddressPort(address: ReturnType<Server['address']>, fallback: number): number {
  if (typeof address === 'object' && address !== null) return address.port
  return fallback
}

function detectTailscaleAddress(): string | null {
  return listTailscaleAddresses()[0] ?? null
}

function listTailscaleAddresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (isTailscaleIpv4(entry.address)) addresses.push(entry.address)
    }
  }
  return addresses.sort()
}

function isTailscaleIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
  const [a, b] = parts
  if (a !== 100 || b === undefined) return false
  return b >= 64 && b <= 127
}
