import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { SessionRef } from '@pi-gui/session-driver'
import { AGENT_SDK_HOOK_CAPABILITIES } from './agent-sdk-hooks'

mock.module('../cursor-sdk-interaction-config', () => ({}))

const {
  applyCursorToolHook,
  buildCursorUserMessage,
  isBenignConnectTransportError,
  isBenignCursorRunError,
} = await import('./cursor-driver')

describe('isBenignCursorRunError', () => {
  it('treats aborted signals as benign', () => {
    const controller = new AbortController()
    controller.abort()
    expect(isBenignCursorRunError(new Error('anything'), controller.signal)).toBe(true)
  })

  it('treats Connect canceled codes as benign', () => {
    const controller = new AbortController()
    const err = Object.assign(new Error('canceled'), { code: 1 })
    expect(isBenignCursorRunError(err, controller.signal)).toBe(true)
  })

  it('does not treat unknown connect errors as benign when not aborted', () => {
    const controller = new AbortController()
    const err = Object.assign(new Error('[unknown] Error'), { code: 2 })
    expect(isBenignCursorRunError(err, controller.signal)).toBe(false)
  })
})

describe('isBenignConnectTransportError', () => {
  it('treats Connect unknown teardown errors as benign', () => {
    const err = Object.assign(new Error('[unknown] Error'), { code: 2 })
    expect(isBenignConnectTransportError(err)).toBe(true)
  })

  it('does not treat unrelated errors as benign', () => {
    expect(isBenignConnectTransportError(new Error('network down'))).toBe(false)
  })
})

describe('buildCursorUserMessage', () => {
  it('returns plain text when no attachments exist', () => {
    expect(buildCursorUserMessage('hello', [])).toBe('hello')
  })

  it('returns SDK user message with images', () => {
    expect(
      buildCursorUserMessage('look', [
        {
          id: 'image-1',
          kind: 'image',
          name: 'screenshot.png',
          mimeType: 'image/png',
          data: 'aW1hZ2U=',
        },
      ]),
    ).toEqual({
      text: 'look',
      images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }],
    })
  })
})

describe('cursor driver skill settings', () => {
  it('loads all Cursor setting sources for local agents', () => {
    const source = readFileSync(join(import.meta.dir, 'cursor-driver.ts'), 'utf-8')
    expect(source).toContain("settingSources: ['all'")
  })
})

describe('applyCursorToolHook', () => {
  const sessionRef: SessionRef = { workspaceId: 'workspace-1', sessionId: 'session-1' }
  const message = {
    type: 'tool_call',
    call_id: 'call-1',
    name: 'shell',
    status: 'running',
    args: { command: 'bun test' },
  } as const

  const startedEvent = {
    provider: 'cursor',
    phase: 'started',
    callId: message.call_id,
    toolName: message.name,
    message,
    raw: message,
    workspacePath: '/tmp/project',
    sessionRef,
    input: message.args,
    capabilities: AGENT_SDK_HOOK_CAPABILITIES,
  } as const

  it('passes through Cursor tool calls when no hook is registered', () => {
    expect(applyCursorToolHook(startedEvent)).toEqual({
      toolName: 'shell',
      input: { command: 'bun test' },
      output: undefined,
      success: undefined,
      diagnostics: undefined,
    })
  })

  it('lets hooks rewrite Cursor tool display fields', () => {
    expect(
      applyCursorToolHook(startedEvent, () => ({
        toolName: 'terminal',
        input: 'rtk test bun test',
      })),
    ).toEqual({
      toolName: 'terminal',
      input: 'rtk test bun test',
      output: undefined,
      success: undefined,
      diagnostics: undefined,
    })
  })

  it('lets hooks suppress Cursor timeline rows', () => {
    expect(applyCursorToolHook(startedEvent, () => ({ suppress: true }))).toBeNull()
  })

  it('keeps Cursor tool rows visible when a hook throws', () => {
    expect(
      applyCursorToolHook(startedEvent, () => {
        throw new Error('cursor hook failed')
      }),
    ).toEqual({
      toolName: 'shell',
      input: { command: 'bun test' },
      output: undefined,
      success: undefined,
      diagnostics: [{ level: 'error', message: 'cursor hook failed' }],
    })
  })
})
