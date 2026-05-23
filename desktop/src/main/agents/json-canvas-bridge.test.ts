import { describe, expect, it } from 'bun:test'
import { emitSyntheticCanvasTool } from './json-canvas-bridge'
import type { AgentTurnContext } from './agent-driver'
import { RENDER_JSON_CANVAS_TOOL_NAME } from '../../shared/json-canvas-schema'

describe('json-canvas-bridge', () => {
  it('emits started and finished synthetic tool events', () => {
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
})
