import { describe, expect, it } from 'bun:test'
import {
  emitSyntheticCanvasTool,
  finishSyntheticCanvasFromText,
  upsertSyntheticCanvasFromText,
} from './json-canvas-bridge'
import type { AgentTurnContext } from './agent-driver'
import { RENDER_JSON_CANVAS_TOOL_NAME } from '../../shared/json-canvas-schema'

describe('json-canvas-bridge', () => {
  it('streams started and finished synthetic tool events', () => {
    const events: unknown[] = []
    const ctx = {
      sessionRef: { workspaceId: 'ws', sessionId: 'sess' },
      emit: (event: unknown) => events.push(event),
    } as unknown as AgentTurnContext

    const params = {
      title: 'Dash',
      canvas: { root: 'r1', elements: { r1: { type: 'Card', props: {} } } },
    }

    emitSyntheticCanvasTool(ctx, params, 'call-1')

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'toolStarted',
      callId: 'call-1',
      toolName: RENDER_JSON_CANVAS_TOOL_NAME,
      input: params,
    })
    expect(events[1]).toMatchObject({
      type: 'toolFinished',
      callId: 'call-1',
      success: true,
      output: params,
    })
  })

  it('upserts partial canvas updates before finish', () => {
    const events: unknown[] = []
    const ctx = {
      sessionRef: { workspaceId: 'ws', sessionId: 'sess' },
      emit: (event: unknown) => events.push(event),
    } as unknown as AgentTurnContext
    const state = { started: false }
    const incomplete =
      '{"title":"Revenue","canvas":{"root":"card-1","elements":{"card-1":{"type":"Card","props":{"title":"Revenue"},"children":["m1"]},"m1":{"type":"Metric","props":{"label":"Total","value":"$'
    const complete = JSON.stringify({
      title: 'Revenue',
      canvas: {
        root: 'card-1',
        elements: {
          'card-1': {
            type: 'Card',
            props: { title: 'Revenue' },
            children: ['m1'],
          },
          m1: { type: 'Metric', props: { label: 'Total', value: '$100' } },
        },
      },
    })

    upsertSyntheticCanvasFromText(ctx, incomplete, 'call-2', state)
    upsertSyntheticCanvasFromText(ctx, complete, 'call-2', state)
    finishSyntheticCanvasFromText(ctx, complete, 'call-2', state)

    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      'toolStarted',
      'toolUpdated',
      'toolFinished',
    ])
    expect(events[1]).toMatchObject({
      type: 'toolUpdated',
      callId: 'call-2',
      output: expect.objectContaining({ title: 'Revenue' }),
    })
  })
})
