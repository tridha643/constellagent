/**
 * Main-process client for the embedded Agentation HTTP/SSE server (default :4747).
 * Forwards SSE → `AGENTATION_EVENT` IPC; exposes status/list/resolve/dismiss and
 * full REST helpers for sessions, annotations, threads, and health.
 */
import type {
  AgentationActionRequested,
  AgentationAnnotation,
  AgentationEvent,
  AgentationSession,
  AgentationStatus,
  AgentationThreadMessage,
} from '../shared/agentation-types'
import {
  embeddedAgentationServerStarted,
  getEmbeddedAgentationEndpoint,
} from './agentation-constants'

export const DEFAULT_AGENTATION_ENDPOINT = getEmbeddedAgentationEndpoint()

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
    if (line === '' || line.startsWith(':')) continue
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

function coerceThreadMessage(raw: unknown): AgentationThreadMessage | null {
  const m = asRecord(raw)
  const id = typeof m.id === 'string' ? m.id : ''
  if (!id) return null
  return {
    id,
    role: m.role === 'agent' ? 'agent' : 'human',
    content: typeof m.content === 'string' ? m.content : '',
    timestamp: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
  }
}

function coerceAnnotation(raw: unknown): AgentationAnnotation {
  const r = asRecord(raw)
  const inner = asRecord(r.annotation)
  const src = 'id' in r ? r : inner
  const a = asRecord(src)
  const reactRaw = a.reactComponents
  let reactComponents: AgentationAnnotation['reactComponents']
  if (Array.isArray(reactRaw)) {
    reactComponents = reactRaw.filter((c): c is string => typeof c === 'string')
  } else if (typeof reactRaw === 'string') {
    reactComponents = reactRaw
  }
  const threadRaw = a.thread
  const thread = Array.isArray(threadRaw)
    ? threadRaw.map(coerceThreadMessage).filter((m): m is AgentationThreadMessage => m != null)
    : undefined
  return {
    id: String(a.id ?? ''),
    comment: typeof a.comment === 'string' ? a.comment : '',
    elementPath: typeof a.elementPath === 'string' ? a.elementPath : undefined,
    timestamp: typeof a.timestamp === 'number' ? a.timestamp : undefined,
    x: typeof a.x === 'number' ? a.x : undefined,
    y: typeof a.y === 'number' ? a.y : undefined,
    element: typeof a.element === 'string' ? a.element : undefined,
    url: typeof a.url === 'string' ? a.url : undefined,
    reactComponents,
    cssClasses: typeof a.cssClasses === 'string' ? a.cssClasses : undefined,
    computedStyles: typeof a.computedStyles === 'string' ? a.computedStyles : undefined,
    accessibility: typeof a.accessibility === 'string' ? a.accessibility : undefined,
    nearbyText: typeof a.nearbyText === 'string' ? a.nearbyText : undefined,
    selectedText: typeof a.selectedText === 'string' ? a.selectedText : undefined,
    boundingBox:
      typeof a.boundingBox === 'object' && a.boundingBox !== null
        ? (a.boundingBox as AgentationAnnotation['boundingBox'])
        : undefined,
    kind:
      a.kind === 'placement' || a.kind === 'rearrange' || a.kind === 'feedback'
        ? a.kind
        : undefined,
    sessionId: typeof a.sessionId === 'string' ? a.sessionId : undefined,
    status:
      a.status === 'pending' ||
      a.status === 'acknowledged' ||
      a.status === 'resolved' ||
      a.status === 'dismissed'
        ? a.status
        : undefined,
    thread: thread?.length ? thread : undefined,
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
    createdAt:
      typeof s.createdAt === 'number' || typeof s.createdAt === 'string' ? s.createdAt : undefined,
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : undefined,
    status:
      s.status === 'active' || s.status === 'approved' || s.status === 'closed'
        ? s.status
        : undefined,
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
  const id = r.id ?? r.annotationId ?? r.sessionId ?? asRecord(r.annotation).id
  return typeof id === 'string' && id ? id : null
}

function coerceActionRequested(raw: unknown): AgentationActionRequested | null {
  const r = asRecord(raw)
  const sessionId = typeof r.sessionId === 'string' ? r.sessionId : ''
  const output = typeof r.output === 'string' ? r.output : ''
  if (!sessionId || !output) return null
  const annotations = Array.isArray(r.annotations)
    ? r.annotations.map(coerceAnnotation)
    : []
  return {
    sessionId,
    output,
    annotations,
    timestamp: typeof r.timestamp === 'string' ? r.timestamp : undefined,
  }
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
    case 'session.updated':
      return { type: 'session.updated', session: coerceSession(payload) }
    case 'session.closed': {
      const sessionId = extractId(payload)
      return sessionId ? { type: 'session.closed', sessionId } : null
    }
    case 'thread.message': {
      const r = asRecord(payload)
      const annotationId =
        typeof r.annotationId === 'string'
          ? r.annotationId
          : typeof asRecord(r.message).annotationId === 'string'
            ? String(asRecord(r.message).annotationId)
            : extractId(payload)
      const message = coerceThreadMessage(r.message ?? r)
      if (!annotationId || !message) return null
      return { type: 'thread.message', annotationId, message }
    }
    case 'action.requested': {
      const action = coerceActionRequested(payload)
      return action ? { type: 'action.requested', action } : null
    }
    default:
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
  private generation = 0
  private status: AgentationStatus = {
    connected: false,
    streaming: false,
    endpoint: DEFAULT_AGENTATION_ENDPOINT,
    embedded: embeddedAgentationServerStarted,
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
    return { ...this.status, embedded: embeddedAgentationServerStarted }
  }

  start(): void {
    if (this.started) return
    this.started = true
    void this.connectLoop()
  }

  async stop(): Promise<void> {
    this.started = false
    this.teardown()
  }

  setEndpoint(endpoint: string): AgentationStatus {
    const next = normalizeEndpoint(endpoint)
    if (next === this.endpoint) return this.getStatus()
    this.endpoint = next
    this.teardown()
    this.status = {
      connected: false,
      streaming: false,
      endpoint: next,
      embedded: embeddedAgentationServerStarted,
    }
    this.emit({ type: 'status', status: this.getStatus() })
    if (this.started) void this.connectLoop()
    return this.getStatus()
  }

  useEmbeddedEndpoint(): AgentationStatus {
    return this.setEndpoint(getEmbeddedAgentationEndpoint())
  }

  async probe(): Promise<AgentationStatus> {
    try {
      const res = await this.fetchImpl(`${this.endpoint}/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      if (!res.ok) {
        const fallback = await this.fetchImpl(`${this.endpoint}/sessions`, {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        })
        this.setStatus({
          connected: fallback.ok,
          error: fallback.ok ? undefined : `HTTP ${fallback.status}`,
        })
      } else {
        this.setStatus({ connected: true, error: undefined })
      }
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

  async getSession(sessionId: string): Promise<AgentationSession | null> {
    if (!sessionId) return null
    try {
      const res = await this.fetchImpl(
        `${this.endpoint}/sessions/${encodeURIComponent(sessionId)}`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      )
      if (!res.ok) return null
      const json = await res.json()
      return coerceSession(json)
    } catch {
      return null
    }
  }

  async createSession(url: string): Promise<AgentationSession | null> {
    try {
      const res = await this.fetchImpl(`${this.endpoint}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!res.ok) return null
      const json = await res.json()
      return coerceSession(json)
    } catch {
      return null
    }
  }

  async getAnnotation(annotationId: string): Promise<AgentationAnnotation | null> {
    if (!annotationId) return null
    try {
      const res = await this.fetchImpl(
        `${this.endpoint}/annotations/${encodeURIComponent(annotationId)}`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      )
      if (!res.ok) return null
      const json = await res.json()
      return coerceAnnotation(json)
    } catch {
      return null
    }
  }

  async deleteAnnotation(annotationId: string): Promise<{ ok: boolean; error?: string }> {
    if (!annotationId) return { ok: false, error: 'missing annotation id' }
    try {
      const res = await this.fetchImpl(
        `${this.endpoint}/annotations/${encodeURIComponent(annotationId)}`,
        { method: 'DELETE', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      )
      if (res.status === 404) return { ok: true }
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  }

  async listPending(sessionId?: string): Promise<AgentationAnnotation[]> {
    try {
      const path = sessionId
        ? `/sessions/${encodeURIComponent(sessionId)}/pending`
        : '/pending'
      const res = await this.fetchImpl(`${this.endpoint}${path}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!res.ok) return []
      const json = await res.json()
      const list = Array.isArray(json)
        ? json
        : Array.isArray(asRecord(json).annotations)
          ? (asRecord(json).annotations as unknown[])
          : []
      return list.map(coerceAnnotation)
    } catch {
      return []
    }
  }

  async addThreadMessage(
    annotationId: string,
    content: string,
    role: 'human' | 'agent' = 'human',
  ): Promise<{ ok: boolean; error?: string }> {
    if (!annotationId) return { ok: false, error: 'missing annotation id' }
    try {
      const res = await this.fetchImpl(
        `${this.endpoint}/annotations/${encodeURIComponent(annotationId)}/thread`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, role }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  }

  async resolve(annotationId: string): Promise<{ ok: boolean; error?: string }> {
    return this.patchAnnotation(annotationId, { resolved: true, status: 'resolved' })
  }

  async dismiss(annotationId: string): Promise<{ ok: boolean; error?: string }> {
    return this.patchAnnotation(annotationId, { dismissed: true, status: 'dismissed' })
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
      if (res.status === 404) return { ok: true }
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  }

  private setStatus(patch: Partial<AgentationStatus>): void {
    const next = {
      ...this.status,
      ...patch,
      endpoint: this.endpoint,
      embedded: embeddedAgentationServerStarted,
    }
    const changed =
      next.connected !== this.status.connected ||
      next.streaming !== this.status.streaming ||
      next.reconnecting !== this.status.reconnecting ||
      next.error !== this.status.error ||
      next.endpoint !== this.status.endpoint ||
      next.embedded !== this.status.embedded
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
