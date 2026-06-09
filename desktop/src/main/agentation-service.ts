/**
 * Main-process client for a locally-running `agentation-mcp` HTTP/SSE server
 * (default http://localhost:4747). constellagent does NOT spawn this server
 * (D2: connect + status only) — it reads the annotation stream and lets the
 * renderer send/resolve/dismiss annotations.
 *
 * Surface consumed:
 *   GET  /events          — SSE: annotation.created|updated|deleted, session.created, …
 *   GET  /sessions        — list sessions (+ their annotations)
 *   PATCH /annotations/:id — resolve / dismiss
 *
 * The renderer never talks to :4747 directly; this service forwards SSE → the
 * `AGENTATION_EVENT` IPC channel (wired in ipc.ts). Pattern reference:
 * composio-webhook-service.ts (long-lived local listener) + the agentChat
 * main→renderer event channels.
 */
import type {
  AgentationAnnotation,
  AgentationEvent,
  AgentationSession,
  AgentationStatus,
} from '../shared/agentation-types'

export const DEFAULT_AGENTATION_ENDPOINT = 'http://localhost:4747'

type FetchImpl = typeof fetch
type EventSink = (event: AgentationEvent) => void

const MAX_BACKOFF_MS = 15_000
const INITIAL_BACKOFF_MS = 1_000
const PROBE_TIMEOUT_MS = 2_000
const REQUEST_TIMEOUT_MS = 3_000

export function normalizeEndpoint(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_AGENTATION_ENDPOINT
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return DEFAULT_AGENTATION_ENDPOINT
  return trimmed
}

interface ParsedSse {
  event: string
  data: string
}

/** Parse one SSE block (the text between blank-line separators) into event/data. */
export function parseSseBlock(block: string): ParsedSse | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line === '' || line.startsWith(':')) continue // heartbeat / comment
    const idx = line.indexOf(':')
    const field = idx === -1 ? line : line.slice(0, idx)
    let value = idx === -1 ? '' : line.slice(idx + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }
  if (dataLines.length === 0 && event === 'message') return null
  return { event, data: dataLines.join('\n') }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function coerceAnnotation(raw: unknown): AgentationAnnotation {
  const r = asRecord(raw)
  const inner = asRecord(r.annotation)
  const src = 'id' in r ? r : inner
  const a = asRecord(src)
  return {
    id: String(a.id ?? ''),
    comment: typeof a.comment === 'string' ? a.comment : '',
    elementPath: typeof a.elementPath === 'string' ? a.elementPath : undefined,
    timestamp: typeof a.timestamp === 'number' ? a.timestamp : undefined,
    x: typeof a.x === 'number' ? a.x : undefined,
    y: typeof a.y === 'number' ? a.y : undefined,
    element: typeof a.element === 'string' ? a.element : undefined,
    url: typeof a.url === 'string' ? a.url : undefined,
    reactComponents: Array.isArray(a.reactComponents)
      ? a.reactComponents.filter((c): c is string => typeof c === 'string')
      : undefined,
    boundingBox:
      typeof a.boundingBox === 'object' && a.boundingBox !== null
        ? (a.boundingBox as AgentationAnnotation['boundingBox'])
        : undefined,
    kind:
      a.kind === 'placement' || a.kind === 'rearrange' || a.kind === 'feedback'
        ? a.kind
        : undefined,
    sessionId: typeof a.sessionId === 'string' ? a.sessionId : undefined,
    resolved: typeof a.resolved === 'boolean' ? a.resolved : undefined,
  }
}

function coerceSession(raw: unknown): AgentationSession {
  const r = asRecord(raw)
  const src = 'id' in r ? r : asRecord(r.session)
  const s = asRecord(src)
  const annotations = Array.isArray(s.annotations) ? s.annotations.map(coerceAnnotation) : []
  return {
    id: String(s.id ?? ''),
    title: typeof s.title === 'string' ? s.title : undefined,
    url: typeof s.url === 'string' ? s.url : undefined,
    createdAt: typeof s.createdAt === 'number' ? s.createdAt : undefined,
    annotations,
  }
}

function coerceSessions(raw: unknown): AgentationSession[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)?.sessions)
      ? ((raw as Record<string, unknown>).sessions as unknown[])
      : []
  return list.map(coerceSession).filter((s) => s.id)
}

function extractId(raw: unknown): string | null {
  if (typeof raw === 'string') return raw
  const r = asRecord(raw)
  const id = r.id ?? r.annotationId ?? asRecord(r.annotation).id
  return typeof id === 'string' && id ? id : null
}

/** Map an agentation-mcp SSE event to our renderer-facing event, or null to drop. */
export function mapSseToAgentationEvent(parsed: ParsedSse): AgentationEvent | null {
  let payload: unknown
  if (parsed.data) {
    try {
      payload = JSON.parse(parsed.data)
    } catch {
      payload = parsed.data
    }
  }
  switch (parsed.event) {
    case 'annotation.created':
      return { type: 'annotation.created', annotation: coerceAnnotation(payload) }
    case 'annotation.updated':
      return { type: 'annotation.updated', annotation: coerceAnnotation(payload) }
    case 'annotation.deleted': {
      const id = extractId(payload)
      return id ? { type: 'annotation.deleted', annotationId: id } : null
    }
    case 'session.created':
      return { type: 'session.created', session: coerceSession(payload) }
    default:
      // action.requested / thread.message / heartbeats → no-op in v1.
      return null
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export class AgentationService {
  private endpoint = DEFAULT_AGENTATION_ENDPOINT
  private readonly fetchImpl: FetchImpl
  private sink: EventSink | null = null
  private abort: AbortController | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private backoffMs = INITIAL_BACKOFF_MS
  private started = false
  /** Bumped on stop / endpoint change to invalidate in-flight connect loops. */
  private generation = 0
  private status: AgentationStatus = {
    connected: false,
    streaming: false,
    endpoint: DEFAULT_AGENTATION_ENDPOINT,
  }

  constructor(opts?: { fetchImpl?: FetchImpl; endpoint?: string }) {
    this.fetchImpl = opts?.fetchImpl ?? ((...args: Parameters<FetchImpl>) => fetch(...args))
    if (opts?.endpoint) {
      this.endpoint = normalizeEndpoint(opts.endpoint)
      this.status.endpoint = this.endpoint
    }
  }

  setEventSink(sink: EventSink | null): void {
    this.sink = sink
  }

  getStatus(): AgentationStatus {
    return { ...this.status }
  }

  /** Begin the SSE connect/reconnect loop (idempotent). */
  start(): void {
    if (this.started) return
    this.started = true
    void this.connectLoop()
  }

  async stop(): Promise<void> {
    this.started = false
    this.teardown()
  }

  /** Change the target endpoint; tears down + reconnects the SSE stream (D7). */
  setEndpoint(endpoint: string): AgentationStatus {
    const next = normalizeEndpoint(endpoint)
    if (next === this.endpoint) return this.getStatus()
    this.endpoint = next
    this.teardown()
    this.status = { connected: false, streaming: false, endpoint: next }
    this.emit({ type: 'status', status: this.getStatus() })
    if (this.started) void this.connectLoop()
    return this.getStatus()
  }

  /** Active probe of the server; updates + returns status. Never throws. */
  async probe(): Promise<AgentationStatus> {
    try {
      const res = await this.fetchImpl(`${this.endpoint}/sessions`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      this.setStatus({ connected: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` })
    } catch (err) {
      this.setStatus({ connected: false, error: errMsg(err) })
    }
    return this.getStatus()
  }

  async listSessions(): Promise<AgentationSession[]> {
    try {
      const res = await this.fetchImpl(`${this.endpoint}/sessions`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!res.ok) {
        this.setStatus({ connected: false, error: `HTTP ${res.status}` })
        return []
      }
      const json = await res.json()
      this.setStatus({ connected: true, error: undefined })
      return coerceSessions(json)
    } catch (err) {
      this.setStatus({ connected: false, streaming: false, error: errMsg(err) })
      return []
    }
  }

  async resolve(annotationId: string): Promise<{ ok: boolean; error?: string }> {
    return this.patchAnnotation(annotationId, { resolved: true })
  }

  async dismiss(annotationId: string): Promise<{ ok: boolean; error?: string }> {
    return this.patchAnnotation(annotationId, { dismissed: true })
  }

  private async patchAnnotation(
    annotationId: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!annotationId) return { ok: false, error: 'missing annotation id' }
    try {
      const res = await this.fetchImpl(
        `${this.endpoint}/annotations/${encodeURIComponent(annotationId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
      // 404 → another reader (the user's own toolbar) already resolved it. Treat
      // as success so the row clears either way (two readers share :4747).
      if (res.status === 404) return { ok: true }
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  }

  private setStatus(patch: Partial<AgentationStatus>): void {
    const next = { ...this.status, ...patch, endpoint: this.endpoint }
    const changed =
      next.connected !== this.status.connected ||
      next.streaming !== this.status.streaming ||
      next.reconnecting !== this.status.reconnecting ||
      next.error !== this.status.error ||
      next.endpoint !== this.status.endpoint
    this.status = next
    if (changed) this.emit({ type: 'status', status: this.getStatus() })
  }

  private emit(event: AgentationEvent): void {
    this.sink?.(event)
  }

  private teardown(): void {
    this.generation++
    if (this.abort) {
      try {
        this.abort.abort()
      } catch {
        /* noop */
      }
      this.abort = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.status = { ...this.status, streaming: false }
  }

  private async connectLoop(): Promise<void> {
    const gen = this.generation
    this.backoffMs = INITIAL_BACKOFF_MS
    while (this.started && gen === this.generation) {
      const ac = new AbortController()
      this.abort = ac
      try {
        const res = await this.fetchImpl(`${this.endpoint}/events`, {
          signal: ac.signal,
          headers: { Accept: 'text/event-stream' },
        })
        if (!res.ok || !res.body) throw new Error(`events HTTP ${res.status}`)
        this.setStatus({ connected: true, streaming: true, reconnecting: false, error: undefined })
        this.backoffMs = INITIAL_BACKOFF_MS
        await this.readStream(res.body, gen)
        // Stream ended cleanly → fall through to reconnect.
      } catch (err) {
        if (gen !== this.generation) return
        this.setStatus({ connected: false, streaming: false, error: errMsg(err) })
      }
      if (!this.started || gen !== this.generation) return
      this.setStatus({ reconnecting: true })
      await this.delay(this.backoffMs)
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS)
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>, gen: number): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (gen !== this.generation) return
        buffer += decoder.decode(value, { stream: true })
        let sep: number
        // SSE records are separated by a blank line (\n\n).
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          const parsed = parseSseBlock(block)
          if (!parsed) continue
          const event = mapSseToAgentationEvent(parsed)
          if (event) this.emit(event)
        }
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {
        /* noop */
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        resolve()
      }, ms)
    })
  }
}

export const agentationService = new AgentationService()
