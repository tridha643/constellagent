import { describe, expect, test } from 'bun:test'
import {
  AgentationService,
  DEFAULT_AGENTATION_ENDPOINT,
  mapSseToAgentationEvent,
  normalizeEndpoint,
  parseSseBlock,
} from './agentation-service'
import { annotationToMarkdown } from '../shared/agentation-types'
import type { AgentationEvent } from '../shared/agentation-types'

/** Minimal fetch Response stand-in for the bits the service reads. */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as unknown as Response
}

function streamResponse(chunks: string[], init?: { ok?: boolean; status?: number }): Response {
  const enc = new TextEncoder()
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]))
      else controller.close()
    },
  })
  return { ok: init?.ok ?? true, status: init?.status ?? 200, body } as unknown as Response
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe('normalizeEndpoint', () => {
  test('strips trailing slashes', () => {
    expect(normalizeEndpoint('http://localhost:4747/')).toBe('http://localhost:4747')
    expect(normalizeEndpoint('http://localhost:4747///')).toBe('http://localhost:4747')
  })
  test('falls back to default for empty / non-string', () => {
    expect(normalizeEndpoint('   ')).toBe(DEFAULT_AGENTATION_ENDPOINT)
    expect(normalizeEndpoint(undefined)).toBe(DEFAULT_AGENTATION_ENDPOINT)
    expect(normalizeEndpoint(42)).toBe(DEFAULT_AGENTATION_ENDPOINT)
  })
})

describe('parseSseBlock', () => {
  test('parses event + data', () => {
    expect(parseSseBlock('event: annotation.created\ndata: {"id":"a1"}')).toEqual({
      event: 'annotation.created',
      data: '{"id":"a1"}',
    })
  })
  test('joins multi-line data and strips one leading space', () => {
    expect(parseSseBlock('event: x\ndata: line1\ndata: line2')).toEqual({
      event: 'x',
      data: 'line1\nline2',
    })
  })
  test('ignores comments / heartbeats and returns null for empty message', () => {
    expect(parseSseBlock(': keep-alive')).toBeNull()
    expect(parseSseBlock('')).toBeNull()
  })
})

describe('mapSseToAgentationEvent', () => {
  test('maps annotation.created with a wrapped payload', () => {
    const ev = mapSseToAgentationEvent({
      event: 'annotation.created',
      data: JSON.stringify({ annotation: { id: 'a1', comment: 'hi', kind: 'feedback' } }),
    })
    expect(ev).toEqual({
      type: 'annotation.created',
      annotation: expect.objectContaining({ id: 'a1', comment: 'hi', kind: 'feedback' }),
    })
  })
  test('maps annotation.deleted from id / annotationId', () => {
    expect(mapSseToAgentationEvent({ event: 'annotation.deleted', data: '{"annotationId":"a9"}' })).toEqual({
      type: 'annotation.deleted',
      annotationId: 'a9',
    })
  })
  test('drops unknown events (action.requested / thread.message)', () => {
    expect(mapSseToAgentationEvent({ event: 'action.requested', data: '{}' })).toBeNull()
    expect(mapSseToAgentationEvent({ event: 'thread.message', data: '{}' })).toBeNull()
  })
  test('coerces unknown kind to undefined', () => {
    const ev = mapSseToAgentationEvent({ event: 'annotation.created', data: '{"id":"a1","kind":"weird"}' })
    expect(ev?.type).toBe('annotation.created')
    if (ev?.type === 'annotation.created') expect(ev.annotation.kind).toBeUndefined()
  })
})

describe('annotationToMarkdown', () => {
  test('renders full annotation with details', () => {
    const md = annotationToMarkdown({
      id: 'a1',
      comment: 'Make this blue',
      kind: 'feedback',
      element: '<button>',
      elementPath: 'div > button',
      reactComponents: ['App', 'Button'],
      url: 'http://localhost:3000',
    })
    expect(md).toContain('**Feedback annotation**')
    expect(md).toContain('Make this blue')
    expect(md).toContain('Element: <button>')
    expect(md).toContain('Path: `div > button`')
    expect(md).toContain('Components: App › Button')
    expect(md).toContain('URL: http://localhost:3000')
  })
  test('degrades gracefully with only a comment', () => {
    const md = annotationToMarkdown({ id: 'a1', comment: 'hey' })
    expect(md).toBe('**Feedback annotation**\n\nhey')
  })
  test('labels placement / rearrange kinds', () => {
    expect(annotationToMarkdown({ id: 'a', comment: '', kind: 'placement' })).toContain('**Placement annotation**')
    expect(annotationToMarkdown({ id: 'a', comment: '', kind: 'rearrange' })).toContain('**Rearrange annotation**')
  })
})

describe('AgentationService HTTP', () => {
  test('probe never throws and reports disconnected on failure', async () => {
    const svc = new AgentationService({ fetchImpl: async () => { throw new Error('ECONNREFUSED') } })
    const status = await svc.probe()
    expect(status.connected).toBe(false)
    expect(status.error).toContain('ECONNREFUSED')
  })

  test('listSessions coerces sessions on success, returns [] on non-ok', async () => {
    const ok = new AgentationService({
      fetchImpl: async () => jsonResponse({ sessions: [{ id: 's1', annotations: [{ id: 'a1', comment: 'x' }] }] }),
    })
    const sessions = await ok.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].annotations[0].id).toBe('a1')

    const down = new AgentationService({ fetchImpl: async () => jsonResponse({}, { ok: false, status: 503 }) })
    expect(await down.listSessions()).toEqual([])
  })

  test('resolve issues a PATCH with {resolved:true}', async () => {
    let captured: { url: string; init: RequestInit | undefined } | null = null
    const svc = new AgentationService({
      fetchImpl: async (url: RequestInfo | URL, init?: RequestInit) => {
        captured = { url: String(url), init }
        return jsonResponse({}, { ok: true })
      },
    })
    const res = await svc.resolve('a1')
    expect(res.ok).toBe(true)
    expect(captured!.url).toBe(`${DEFAULT_AGENTATION_ENDPOINT}/annotations/a1`)
    expect(captured!.init?.method).toBe('PATCH')
    expect(JSON.parse(String(captured!.init?.body))).toEqual({ resolved: true })
  })

  test('dismiss issues a PATCH with {dismissed:true}', async () => {
    let body: unknown = null
    const svc = new AgentationService({
      fetchImpl: async (_url: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body))
        return jsonResponse({}, { ok: true })
      },
    })
    await svc.dismiss('a2')
    expect(body).toEqual({ dismissed: true })
  })

  test('PATCH 404 (already resolved by another reader) is treated as success', async () => {
    const svc = new AgentationService({ fetchImpl: async () => jsonResponse({}, { ok: false, status: 404 }) })
    expect(await svc.resolve('gone')).toEqual({ ok: true })
  })
})

describe('AgentationService endpoint + streaming', () => {
  test('setEndpoint changes endpoint and emits a status event; no-op when unchanged', () => {
    const events: AgentationEvent[] = []
    const svc = new AgentationService()
    svc.setEventSink((e) => events.push(e))

    const status = svc.setEndpoint('http://localhost:5000/')
    expect(status.endpoint).toBe('http://localhost:5000')
    expect(events[events.length - 1]).toEqual({
      type: 'status',
      status: expect.objectContaining({ endpoint: 'http://localhost:5000' }),
    })

    const before = events.length
    svc.setEndpoint('http://localhost:5000') // normalizes to the same value
    expect(events.length).toBe(before)
  })

  test('streams SSE events through to the sink', async () => {
    const events: AgentationEvent[] = []
    const svc = new AgentationService({
      fetchImpl: async (url: RequestInfo | URL) => {
        if (String(url).endsWith('/events')) {
          return streamResponse([
            'event: annotation.created\ndata: {"id":"a1","comment":"first"}\n\n',
            'event: annotation.deleted\ndata: {"id":"a1"}\n\n',
          ])
        }
        return jsonResponse({})
      },
    })
    svc.setEventSink((e) => events.push(e))
    svc.start()
    await tick()
    await tick()

    const created = events.find((e) => e.type === 'annotation.created')
    const deleted = events.find((e) => e.type === 'annotation.deleted')
    expect(created).toBeDefined()
    expect(deleted).toEqual({ type: 'annotation.deleted', annotationId: 'a1' })
    await svc.stop()
  })

  test('a failed connect reports disconnected then reconnecting (no throw)', async () => {
    const events: AgentationEvent[] = []
    const svc = new AgentationService({ fetchImpl: async () => { throw new Error('ECONNREFUSED') } })
    svc.setEventSink((e) => events.push(e))
    svc.start()
    await tick()
    await tick()

    const statuses = events.filter((e): e is Extract<AgentationEvent, { type: 'status' }> => e.type === 'status')
    expect(statuses.some((s) => s.status.connected === false)).toBe(true)
    expect(statuses.some((s) => s.status.reconnecting === true)).toBe(true)
    await svc.stop()
  })
})
