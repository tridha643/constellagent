import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
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
  type PairingQrPayload,
} from '@constellagent/mobile-protocol'
import { listPersistedMobileWorkspaces } from './persisted-state'
import { MobileStore } from './mobile-store'
import {
  createBridgeSecureTransport,
  type BridgeSecureTransport,
  type BridgeSecureTransportDeviceState,
} from './mobile-secure-transport'
import QRCode from 'qrcode'
import { buildPairingPayload, serializePairingPayload } from './mobile-pairing-qr'
import type { MobileConnectionSnapshot, MobilePairingPayloadResult } from '../shared/mobile-settings-types'
import { MobilePairingCodeRegistry } from './mobile-pairing-code-registry'
import { resolveTrustedSession, type TrustedSessionResolveRequest } from './mobile-trusted-session-resolve'
import { createMobileMethodRouter, type MobileRouter } from './mobile-method-router'
import { GitService } from './git-service'
import { AnnotationService } from './annotation-service'
import { getAgentChatHost } from './agent-chat-host'
import { createMobileEventBridge, type MobileEventBridge } from './mobile-event-bridge'
import { buildMobileRelayWsUrl, parseWebSocketUpgradePath } from './mobile-ws-path'
import {
  adaptInboundRequest,
  adaptOutboundEvent,
  adaptOutboundResponse,
  adaptStructuredUserInputResponse,
  parseInboundMobileRpc,
  parseInboundMobileRpcResponse,
} from './mobile-rpc-adapter'
import { broadcastMobileFocusSession } from './mobile-focus-session'
import {
  handleMobileGitBridgeMethod,
  isMobileGitBridgeMethod,
  MobileGitBridgeError,
} from './mobile-git-bridge'
import {
  handleMobileProjectMethod,
  isMobileProjectMethod,
} from './mobile-project-folders'
import {
  isMobileAccessEnabled,
  listTailscaleAddresses,
  resolveMobileAdvertisedHost,
  resolveMobileListenHost,
} from './mobile-network'
import { MobileDebugTimer, mobileDebugLog, mobileDebugWarn } from './mobile-debug-log'

const DEFAULT_PORT = 3987

interface MobileLocalServerOptions {
  readonly enabled?: boolean
  readonly host?: string
  readonly port?: number
  readonly token?: string
  readonly displayName?: string
  readonly store?: MobileStore
}

interface AuthResult {
  readonly ok: boolean
  readonly deviceId: string
}

interface SecureSocketState {
  readonly socket: WebSocket
  readonly sessionId: string
  readonly transport: BridgeSecureTransport
}

export interface MobileRouterFactoryDeps {
  readonly createRouter?: (server: MobileLocalServer) => MobileRouter
  readonly createEventBridge?: (server: MobileLocalServer) => MobileEventBridge
}

export class MobileLocalServer {
  private readonly store: MobileStore
  private readonly enabled: boolean
  private readonly configuredHost?: string
  private readonly configuredPort: number
  private readonly token?: string
  private readonly displayName: string
  private server: Server | null = null
  private wsServer: WebSocketServer | null = null
  private sockets = new Set<WebSocket>()
  private secureSockets = new Map<WebSocket, SecureSocketState>()
  private runningHost = ''
  private runningPort = 0
  private bridgeIdentityPromise: Promise<BridgeSecureTransportDeviceState> | null = null
  private router: MobileRouter | null = null
  private eventBridge: MobileEventBridge | null = null
  private readonly pairingCodeRegistry = new MobilePairingCodeRegistry()
  private readonly blockingQuestionSessionByRequestId = new Map<string, string>()
  private readonly routerFactory?: MobileRouterFactoryDeps['createRouter']
  private readonly eventBridgeFactory?: MobileRouterFactoryDeps['createEventBridge']

  constructor(options: MobileLocalServerOptions & MobileRouterFactoryDeps = {}) {
    this.store = options.store ?? new MobileStore()
    this.enabled = isMobileAccessEnabled(options.enabled)
    this.configuredHost = options.host ?? process.env.CONSTELLAGENT_MOBILE_HOST
    this.configuredPort = options.port ?? parsePort(process.env.CONSTELLAGENT_MOBILE_PORT)
    this.token = options.token ?? process.env.CONSTELLAGENT_MOBILE_TOKEN
    this.displayName = (options.displayName ?? 'Constellagent').trim()
    this.routerFactory = options.createRouter
    this.eventBridgeFactory = options.createEventBridge
  }

  async start(): Promise<void> {
    if (!this.enabled || this.server) return
    const host = resolveMobileListenHost(this.configuredHost)
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
        this.ensureRouterAndEventBridge()
        void this.refreshActivePairingCode()
          .then(({ code }) => {
            console.info('[mobile] pair with code:', code, '(expires in 5 min)')
          })
          .catch((error) => {
            console.warn('[mobile] failed to register pairing code', error)
          })
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
    this.secureSockets.clear()
    this.wsServer?.close()
    this.wsServer = null
    this.eventBridge?.dispose()
    this.eventBridge = null
    this.router = null
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
    const host = resolveMobileAdvertisedHost(this.configuredHost, this.runningHost)
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

  getConnectionSnapshot(): MobileConnectionSnapshot {
    const status = this.getStatus()
    const activePairingCode = this.pairingCodeRegistry.getActive()
    let connectedSecureChannels = 0
    for (const state of this.secureSockets.values()) {
      if (state.transport.isSecureChannelReady()) {
        connectedSecureChannels += 1
      }
    }
    return {
      ...status,
      websocketConnections: this.secureSockets.size,
      connectedSecureChannels,
      ...(activePairingCode
        ? {
            pairingCode: activePairingCode.code,
            pairingCodeExpiresAt: activePairingCode.expiresAtMs,
          }
        : {}),
    }
  }

  /** Used by the renderer Settings panel to render a fresh pairing QR. */
  async createPairingPayload(): Promise<MobilePairingPayloadResult> {
    const { payload, code } = await this.refreshActivePairingCode()
    const qrPayloadJson = serializePairingPayload(payload)
    const qrDataUrl = await QRCode.toDataURL(qrPayloadJson, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 280,
    })
    console.info('[mobile] pair with code:', code, '(expires in 5 min)')
    return { ...payload, shortCode: code, qrDataUrl, qrPayloadJson }
  }

  private async refreshActivePairingCode(): Promise<{ payload: PairingQrPayload; code: string }> {
    const identity = await this.ensureBridgeIdentity()
    const status = this.getStatus()
    const wsUrl = buildMobileRelayWsUrl(status.host, status.port)
    const payload = buildPairingPayload({
      relayUrl: wsUrl,
      sessionId: randomUUID(),
      macDeviceId: identity.macDeviceId,
      macIdentityPublicKey: identity.macIdentityPublicKey,
      displayName: this.displayName,
    })
    const active = this.pairingCodeRegistry.register(payload)
    return { payload, code: active.code }
  }

  /** Returns the currently-trusted phones. */
  async listTrustedPhones(): Promise<Array<{ phoneDeviceId: string; phoneIdentityPublicKey: string }>> {
    const map = await this.store.listTrustedPhones()
    return Object.entries(map).map(([phoneDeviceId, phoneIdentityPublicKey]) => ({
      phoneDeviceId,
      phoneIdentityPublicKey,
    }))
  }

  async revokeTrustedPhone(phoneDeviceId: string): Promise<void> {
    await this.store.revokeTrustedPhone(phoneDeviceId)
  }

  async publishEvent(input: Parameters<MobileStore['appendEvent']>[0]): Promise<MobileEvent> {
    const event = await this.store.appendEvent(input)
    // Fan out to every authenticated phone via the secure transport — the
    // rpcEvent envelope is wrapped in queueOutboundApplicationMessage so
    // reconnects automatically catch up via the outbound buffer.
    const encoded = JSON.stringify({ kind: 'rpcEvent', event })
    for (const state of this.secureSockets.values()) {
      const notification = adaptOutboundEvent(event)
      if (notification) {
        this.rememberOutboundMobileRequest(notification, event)
        state.transport.queueOutboundApplicationMessage(JSON.stringify(notification))
        continue
      }
      state.transport.queueOutboundApplicationMessage(encoded)
    }
    return event
  }

  private rememberOutboundMobileRequest(message: Record<string, unknown>, event: MobileEvent): void {
    const id = typeof message.id === 'string' ? message.id : null
    const method = typeof message.method === 'string' ? message.method : null
    if (!id || !event.sessionId) return
    if (method === 'item/tool/requestUserInput' || method === 'tool/requestUserInput') {
      this.blockingQuestionSessionByRequestId.set(id, event.sessionId)
    }
  }

  private ensureRouterAndEventBridge(): void {
    if (!this.router) {
      this.router = this.routerFactory
        ? this.routerFactory(this)
        : createMobileMethodRouter({
            agentChatHost: getAgentChatHost(),
            gitService: GitService,
            annotationService: AnnotationService,
            listMobileWorkspaces: listPersistedMobileWorkspaces,
            onSessionStarted: broadcastMobileFocusSession,
            onSessionSubmitFailed: ({ sessionId, error }) => {
              mobileDebugWarn('local-server', 'session.reply submit failed; publishing completion event', {
                sessionId,
                error,
              })
              void this.publishEvent({
                type: 'session.message.completed',
                sessionId,
                payload: { status: 'failed', error },
              })
            },
          })
    }
    if (!this.eventBridge) {
      this.eventBridge = this.eventBridgeFactory
        ? this.eventBridgeFactory(this)
        : createMobileEventBridge({ agentChatHost: getAgentChatHost(), mobileServer: this })
    }
  }

  private async handleInboundMobileRpcResponse(payloadText: string): Promise<boolean> {
    const response = parseInboundMobileRpcResponse(payloadText)
    if (!response) return false

    const sessionId = this.blockingQuestionSessionByRequestId.get(response.id)
    if (!sessionId) {
      mobileDebugWarn('local-server', 'dropping untracked mobile rpc response', { requestId: response.id })
      return true
    }

    try {
      const host = getAgentChatHost()
      const session = await host.getSession(sessionId)
      const blockingQuestion = session?.state.blockingQuestion
      if (!blockingQuestion || blockingQuestion.requestId !== response.id) {
        this.blockingQuestionSessionByRequestId.delete(response.id)
        mobileDebugWarn('local-server', 'mobile rpc response no longer matches a blocking question', {
          requestId: response.id,
          sessionId,
        })
        return true
      }

      await host.respondBlockingQuestion(sessionId, {
        requestId: response.id,
        details: adaptStructuredUserInputResponse(response, blockingQuestion),
      })
      this.blockingQuestionSessionByRequestId.delete(response.id)
      mobileDebugLog('local-server', 'mobile rpc response applied to blocking question', {
        requestId: response.id,
        sessionId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mobileDebugWarn('local-server', 'failed to apply mobile rpc response', {
        requestId: response.id,
        sessionId,
        error: message,
      })
    }
    return true
  }

  private async dispatchSecurePayload(
    payloadText: string,
    sessionId: string,
    transport: BridgeSecureTransport,
  ): Promise<void> {
    this.ensureRouterAndEventBridge()
    const router = this.router
    if (!router) return

    if (await this.handleInboundMobileRpcResponse(payloadText)) {
      return
    }

    const inbound = parseInboundMobileRpc(payloadText)
    if (!inbound) {
      const legacy = await router.handleApplicationMessage(payloadText)
      if (!legacy) return
      transport.queueOutboundApplicationMessage(JSON.stringify(legacy))
      return
    }

    if (isMobileProjectMethod(inbound.method)) {
      try {
        const result = await handleMobileProjectMethod(inbound.method, inbound.params)
        transport.queueOutboundApplicationMessage(JSON.stringify({ id: inbound.id, result }))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Project folder request failed.'
        transport.queueOutboundApplicationMessage(JSON.stringify({
          id: inbound.id,
          error: { code: -32000, message },
        }))
      }
      return
    }

    if (isMobileGitBridgeMethod(inbound.method)) {
      try {
        const result = await handleMobileGitBridgeMethod(inbound.method, inbound.params)
        transport.queueOutboundApplicationMessage(JSON.stringify({ id: inbound.id, result }))
      } catch (error) {
        const bridgeCode = error instanceof MobileGitBridgeError ? error.code : 'internal_error'
        const message = error instanceof Error ? error.message : 'Git bridge request failed.'
        transport.queueOutboundApplicationMessage(JSON.stringify({
          id: inbound.id,
          error: {
            code: -32000,
            message,
            data: { bridgeCode, errorCode: bridgeCode },
          },
        }))
      }
      return
    }

    const request = adaptInboundRequest(inbound)
    const rpcTimer = new MobileDebugTimer('local-server', 'mobile.rpc', {
      sessionId,
      codexMethod: inbound.method,
      bridgeMethod: request.method,
      requestId: inbound.id,
      payloadBytes: payloadText.length,
    })
    const response = await router.handleApplicationMessage(JSON.stringify(request))
    if (!response) {
      rpcTimer.finish({ dropped: true })
      return
    }
    const outbound = adaptOutboundResponse(inbound, response)
    rpcTimer.finish({
      ok: response.error == null,
      errorCode: response.error?.code ?? null,
      outboundBytes: JSON.stringify(outbound).length,
    })
    transport.queueOutboundApplicationMessage(JSON.stringify(outbound))
    // Audit trail for authenticated RPC calls — keep it lightweight (no payload).
    void this.store
      .addAuditEvent(null, 'mobile.rpc', {
        sessionId,
        bytes: payloadText.length,
        responseId: response.id,
        ok: response.error == null,
      })
      .catch(() => {})
  }

  private ensureBridgeIdentity(): Promise<BridgeSecureTransportDeviceState> {
    if (!this.bridgeIdentityPromise) {
      this.bridgeIdentityPromise = this.store.loadOrCreateBridgeDeviceState()
    }
    return this.bridgeIdentityPromise
  }

  private attachWebSocketServer(server: Server): void {
    const wsServer = new WebSocketServer({ noServer: true })
    this.wsServer = wsServer
    server.on('upgrade', (req, socket, head) => {
      const url = parseRequestUrl(req)
      const upgradePath = url ? parseWebSocketUpgradePath(url.pathname) : null
      if (!upgradePath?.accepted) {
        socket.destroy()
        return
      }
      wsServer.handleUpgrade(req, socket, head, (ws) => {
        this.sockets.add(ws)
        // Attach secure transport lazily so the bridge identity load is awaited
        // off the upgrade callback (which must complete synchronously to ws).
        void this.attachSecureTransport(ws, upgradePath.pairingSessionId).catch((error) => {
          console.error('[mobile] secure transport attach failed', error)
          try {
            ws.send(JSON.stringify({
              kind: 'secureError',
              code: 'bridge_unavailable',
              message: 'The desktop bridge could not initialize the secure channel.',
            }))
          } catch {}
          ws.close(1011, 'Secure transport unavailable')
        })
        ws.on('close', () => {
          this.sockets.delete(ws)
          this.secureSockets.delete(ws)
        })
      })
    })
  }

  private async attachSecureTransport(
    ws: WebSocket,
    pairingSessionId?: string,
  ): Promise<void> {
    const identity = await this.ensureBridgeIdentity()
    // iPhone connects to `{relay}/{sessionId}` (e.g. `/ws/<uuid>`). Reuse that id so
    // the QR bootstrap handshake matches the transport the bridge expects.
    const sessionId = pairingSessionId?.trim() || randomUUID()
    const activePairingPayload = pairingSessionId
      ? this.pairingCodeRegistry.getActivePayloadForSessionId(sessionId)
      : null
    const status = this.getStatus()
    const wsUrl = buildMobileRelayWsUrl(status.host, status.port)
    const transport = createBridgeSecureTransport({
      sessionId,
      relayUrl: wsUrl,
      deviceState: identity,
      displayName: this.displayName,
      pairingExpiresAtMs: activePairingPayload?.expiresAt,
      onTrustedPhoneUpdate: ({ phoneDeviceId, phoneIdentityPublicKey }) => {
        // Persist the newly trusted phone so future reconnects skip the QR flow.
        void this.store
          .rememberTrustedPhone(phoneDeviceId, phoneIdentityPublicKey, { sessionId })
          .catch((error) => console.warn('[mobile] rememberTrustedPhone failed', error))
      },
    })
    transport.bindLiveSendWireMessage((raw) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(raw)
        return true
      }
      return false
    })
    this.secureSockets.set(ws, { socket: ws, sessionId, transport })

    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8')
      transport.handleIncomingWireMessage(raw, {
        sendControlMessage: (message) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(message))
          }
        },
        onApplicationMessage: (payloadText) => {
          void this.dispatchSecurePayload(payloadText, sessionId, transport).catch((error) => {
            console.warn('[mobile] router dispatch failed', error)
          })
        },
      })
    })

    ws.on('close', () => transport.bindLiveSendWireMessage(null))
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
      const activePairingCode = this.pairingCodeRegistry.getActive()
      writeJson(res, 200, {
        ...this.getStatus(),
        ...(activePairingCode
          ? {
              pairingCode: activePairingCode.code,
              pairingCodeExpiresAt: activePairingCode.expiresAtMs,
            }
          : {}),
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/v1/pairing/code/resolve') {
      await this.handlePairingCodeResolve(req, res)
      return
    }

    if (req.method === 'POST' && url.pathname === '/v1/trusted/session/resolve') {
      await this.handleTrustedSessionResolve(req, res)
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

  private async handleTrustedSessionResolve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req)
    let request: TrustedSessionResolveRequest
    try {
      const parsed = JSON.parse(raw || '{}') as Partial<TrustedSessionResolveRequest>
      request = {
        macDeviceId: typeof parsed.macDeviceId === 'string' ? parsed.macDeviceId : '',
        phoneDeviceId: typeof parsed.phoneDeviceId === 'string' ? parsed.phoneDeviceId : '',
        phoneIdentityPublicKey:
          typeof parsed.phoneIdentityPublicKey === 'string' ? parsed.phoneIdentityPublicKey : '',
        nonce: typeof parsed.nonce === 'string' ? parsed.nonce : '',
        timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Number.NaN,
        signature: typeof parsed.signature === 'string' ? parsed.signature : '',
      }
    } catch {
      writeJson(res, 400, {
        ok: false,
        code: 'invalid_signature',
        error: 'Invalid trusted reconnect request.',
      })
      return
    }

    const identity = await this.ensureBridgeIdentity()
    const trustedPhonePublicKey = identity.trustedPhones[request.phoneDeviceId.trim()] ?? null
    const result = resolveTrustedSession({
      request,
      bridgeMacDeviceId: identity.macDeviceId,
      bridgeMacIdentityPublicKey: identity.macIdentityPublicKey,
      bridgeDisplayName: this.displayName,
      trustedPhonePublicKey,
      bridgeRunning: this.server !== null,
    })

    if (!result.ok) {
      const status = result.code === 'session_unavailable'
        ? 503
        : result.code === 'resolve_request_expired' || result.code === 'resolve_request_replayed'
          ? 409
          : 403
      writeJson(res, status, result)
      return
    }

    writeJson(res, 200, result)
  }

  private async handlePairingCodeResolve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req)
    let code = ''
    try {
      const parsed = JSON.parse(raw || '{}') as { code?: unknown }
      code = typeof parsed.code === 'string' ? parsed.code : ''
    } catch {
      writeJson(res, 400, {
        ok: false,
        code: 'pairing_code_unavailable',
        error: 'Invalid pairing code request.',
      })
      return
    }

    const result = this.pairingCodeRegistry.resolve(code)
    if (!result.ok) {
      writeJson(res, result.code === 'pairing_code_expired' ? 410 : 404, result)
      return
    }

    writeJson(res, 200, result)
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

