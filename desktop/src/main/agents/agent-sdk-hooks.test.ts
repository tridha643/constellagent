import { describe, expect, test } from 'bun:test'
import type { SessionRef } from '@pi-gui/session-driver'
import {
  AGENT_SDK_HOOK_CAPABILITIES,
  applyAgentSdkToolHook,
  type AgentSdkToolHookEvent,
} from './agent-sdk-hooks'

const sessionRef: SessionRef = { workspaceId: 'workspace-1', sessionId: 'session-1' }

function event(overrides: Partial<AgentSdkToolHookEvent> = {}): AgentSdkToolHookEvent {
  return {
    provider: 'cursor',
    phase: 'started',
    callId: 'call-1',
    toolName: 'shell',
    workspacePath: '/tmp/project',
    sessionRef,
    raw: { type: 'tool_call' },
    input: 'bun test',
    capabilities: AGENT_SDK_HOOK_CAPABILITIES,
    ...overrides,
  }
}

describe('applyAgentSdkToolHook', () => {
  test('passes through SDK tool emissions when no hook is registered', () => {
    expect(applyAgentSdkToolHook(event())).toEqual({
      toolName: 'shell',
      input: 'bun test',
      output: undefined,
      success: undefined,
      diagnostics: undefined,
    })
  })

  test('lets hooks reshape timeline-only display fields', () => {
    expect(
      applyAgentSdkToolHook(event(), () => ({
        toolName: 'test',
        input: 'rtk test bun test',
      })),
    ).toEqual({
      toolName: 'test',
      input: 'rtk test bun test',
      output: undefined,
      success: undefined,
      diagnostics: undefined,
    })
  })

  test('lets hooks suppress timeline emissions without claiming policy blocking', () => {
    expect(event().capabilities).toEqual({
      canSuppressTimeline: true,
      canBlockProviderAction: false,
    })
    expect(applyAgentSdkToolHook(event(), () => ({ suppress: true }))).toBeNull()
  })

  test('keeps provider output visible when a hook throws', () => {
    expect(
      applyAgentSdkToolHook(event({ phase: 'finished', output: 'ok', success: true }), () => {
        throw new Error('bad hook')
      }),
    ).toEqual({
      toolName: 'shell',
      input: 'bun test',
      output: 'ok',
      success: true,
      diagnostics: [{ level: 'error', message: 'bad hook' }],
    })
  })
})
