import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { buildAgentPrompt } from './agent-driver'
import {
  buildCodexUserInput,
  codexConfigForWebSockets,
  codexSdkEnv,
  codexSdkModelForConductorModel,
  isCodexWebSocketsEligibleModel,
  isBenignCodexInterruptError,
  isStaleCodexThreadError,
  shouldUseCodexWebSockets,
} from './codex-driver'

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

  test('uses canvas schema instructions instead of markdown when canvas mode is on', () => {
    const prompt = buildAgentPrompt('build a dashboard', false, undefined, 'codex', true)
    expect(prompt).toContain('Canvas mode is active')
    expect(prompt).not.toContain('GitHub-Flavored Markdown')
  })
})

describe('CodexDriver streaming transport', () => {
  test('keeps the Codex turn on runStreamed', () => {
    const source = readFileSync(new URL('./codex-driver.ts', import.meta.url), 'utf8')
    expect(source).toContain('thread.runStreamed(')
  })

  test('passes structured input (with local_image) to runStreamed, not prompt alone', () => {
    const source = readFileSync(new URL('./codex-driver.ts', import.meta.url), 'utf8')
    expect(source).toContain('thread.runStreamed(input')
    expect(source).not.toMatch(/thread\.runStreamed\(prompt/)
  })

  test('passes outputSchema on canvas turns for native structured JSON', () => {
    const source = readFileSync(new URL('./codex-driver.ts', import.meta.url), 'utf8')
    expect(source).toContain('outputSchema: renderJsonCanvasOutputSchema()')
    expect(source).toContain('upsertSyntheticCanvasFromText')
  })
})

describe('CodexDriver CLI environment', () => {
  test('builds a string-only SDK env with PATH for spawning the user CLI', () => {
    const env = codexSdkEnv()
    expect(typeof env.PATH).toBe('string')
    expect(env.PATH.length).toBeGreaterThan(0)
    expect(Object.values(env).every((value) => typeof value === 'string')).toBe(true)
  })
})

describe('codexSdkModelForConductorModel', () => {
  test('preserves fast mode for Codex SDK model selection', () => {
    expect(codexSdkModelForConductorModel('gpt-5.3-codex-fast')).toBe('gpt-5.3-codex-fast')
  })

  test('strips conductor effort suffixes because Codex SDK receives effort separately', () => {
    expect(codexSdkModelForConductorModel('gpt-5.3-codex-high-fast')).toBe('gpt-5.3-codex-fast')
    expect(codexSdkModelForConductorModel('gpt-5.3-codex-high')).toBe('gpt-5.3-codex')
  })
})

describe('Codex WebSocket config', () => {
  test('recognizes Codex models after effort and speed suffix normalization', () => {
    expect(isCodexWebSocketsEligibleModel('gpt-5.3-codex-high-fast')).toBe(true)
    expect(isCodexWebSocketsEligibleModel('gpt-5.3-codex-spark-xhigh')).toBe(true)
  })

  test('does not enable WebSockets for non-Codex model ids', () => {
    expect(isCodexWebSocketsEligibleModel('gpt-5.5')).toBe(false)
    expect(isCodexWebSocketsEligibleModel('o3')).toBe(false)
  })

  test('uses WebSockets only when the setting is auto and the model is eligible', () => {
    expect(shouldUseCodexWebSockets('auto', 'gpt-5.3-codex-high-fast')).toBe(true)
    expect(shouldUseCodexWebSockets('off', 'gpt-5.3-codex-high-fast')).toBe(false)
    expect(shouldUseCodexWebSockets('auto', 'gpt-5.5')).toBe(false)
  })

  test('builds the Codex CLI provider capability override only when enabled', () => {
    expect(codexConfigForWebSockets(true)).toEqual({
      model_providers: {
        openai: {
          supports_websockets: true,
        },
      },
    })
    expect(codexConfigForWebSockets(false)).toBeUndefined()
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

describe('buildCodexUserInput', () => {
  test('returns plain prompt when no image paths exist', () => {
    expect(buildCodexUserInput('hello', [])).toBe('hello')
  })

  test('builds structured text plus local_image input', () => {
    expect(buildCodexUserInput('look', ['/tmp/a.png'])).toEqual([
      { type: 'text', text: 'look' },
      { type: 'local_image', path: '/tmp/a.png' },
    ])
  })
})
