import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { buildAgentPrompt } from './agent-driver'
import { isBenignCodexInterruptError, isStaleCodexThreadError } from './codex-driver'

describe('CodexDriver prompt seeding', () => {
  test('omits transcript when SDK thread carries history (primary path)', () => {
    const prompt = buildAgentPrompt('next step', false, undefined)
    expect(prompt).not.toContain('Previous conversation context')
    expect(prompt).toContain('next step')
  })

  test('includes prior transcript only on Conductor fallback after interrupt or stale resume', () => {
    const prompt = buildAgentPrompt(
      'continue and build the plan',
      false,
      [
        {
          kind: 'message',
          id: 'u1',
          role: 'user',
          text: 'make a queue system',
          createdAt: '',
        },
      ],
    )
    expect(prompt).toContain('Previous conversation context')
    expect(prompt).toContain('make a queue system')
    expect(prompt).toContain('Current user request:\ncontinue and build the plan')
  })
})

describe('CodexDriver streaming transport', () => {
  test('keeps the Codex turn on runStreamed', () => {
    const source = readFileSync(new URL('./codex-driver.ts', import.meta.url), 'utf8')
    expect(source).toContain('thread.runStreamed(')
  })
})

describe('isBenignCodexInterruptError', () => {
  test('treats aborted signal as benign', () => {
    const controller = new AbortController()
    controller.abort()
    expect(isBenignCodexInterruptError(new Error('anything'), controller.signal)).toBe(true)
  })

  test('treats Codex exec signal exit as benign when user aborted', () => {
    const controller = new AbortController()
    controller.abort()
    const err = new Error('Codex Exec exited with signal SIGTERM: ')
    expect(isBenignCodexInterruptError(err, controller.signal)).toBe(true)
  })

  test('does not treat unrelated errors as benign when not aborted', () => {
    const controller = new AbortController()
    expect(isBenignCodexInterruptError(new Error('network timeout'), controller.signal)).toBe(false)
  })
})

describe('isStaleCodexThreadError', () => {
  test('detects thread/resume rollout failures from Codex CLI', () => {
    const err = new Error(
      'Codex Exec exited with code 1: Error: thread/resume: thread/resume failed: no rollout found for thread id abc (code -32600)',
    )
    expect(isStaleCodexThreadError(err)).toBe(true)
  })

  test('ignores unrelated errors', () => {
    expect(isStaleCodexThreadError(new Error('network timeout'))).toBe(false)
  })
})
