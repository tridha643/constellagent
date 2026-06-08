import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SessionDriverEvent, SessionRef } from '@pi-gui/session-driver'
import { AGENT_SDK_HOOK_CAPABILITIES } from './agent-sdk-hooks'
import { buildAgentPrompt, CONDUCTOR_RTK_PROMPT_PREFIX } from './agent-driver'
import {
  applyCodexToolHook,
  buildCodexUserInput,
  CodexDriver,
  codexCliSupportsSdkExec,
  codexConfigForWebSockets,
  codexSdkEnv,
  codexSdkModelForConductorModel,
  isCodexWebSocketsEligibleModel,
  isBenignCodexInterruptError,
  isStaleCodexThreadError,
  resolveCodexCliPath,
  shouldSeedFreshCodexThread,
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

  test('uses inline canvas instructions instead of markdown when canvas mode is on', () => {
    const prompt = buildAgentPrompt('build a dashboard', false, undefined, 'codex', true)
    expect(prompt).toContain('Canvas mode is active')
    expect(prompt).toContain('inline generation')
    expect(prompt).not.toContain('GitHub-Flavored Markdown')
    expect(prompt).not.toContain(CONDUCTOR_RTK_PROMPT_PREFIX)
  })

  test('seeds prior Conductor transcript when Codex starts a fresh handoff thread', () => {
    expect(
      shouldSeedFreshCodexThread(false, [
        {
          kind: 'message',
          id: 'a1',
          role: 'assistant',
          text: '## Plan\n- [ ] Build it',
          createdAt: '',
        },
      ]),
    ).toBe(true)
  })

  test('does not seed empty transcript into a normal first Codex turn', () => {
    expect(shouldSeedFreshCodexThread(false, [])).toBe(false)
    expect(shouldSeedFreshCodexThread(false, undefined)).toBe(false)
  })
})

describe('CodexDriver streaming transport', () => {
  test('keeps the Codex turn on runStreamed', () => {
    const source = readFileSync(new URL('./codex-driver.ts', import.meta.url), 'utf8')
    expect(source).toContain('thread.runStreamed(input,')
  })

  test('passes structured input (with local_image) to runStreamed, not prompt alone', () => {
    const source = readFileSync(new URL('./codex-driver.ts', import.meta.url), 'utf8')
    expect(source).toContain('thread.runStreamed(input')
    expect(source).not.toMatch(/thread\.runStreamed\(prompt/)
  })

  test('streams inline canvas text through assistant deltas', () => {
    const source = readFileSync(new URL('./codex-driver.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('outputSchema: renderJsonCanvasOutputSchema()')
    expect(source).not.toContain('upsertSyntheticCanvasFromText')
    expect(source).toContain('evAssistantDelta')
  })

  test('suspends the stream after native request_user_input before follow-up assistant text', async () => {
    const driver = new CodexDriver()
    const emitted: SessionDriverEvent[] = []
    const sessionRef: SessionRef = { workspaceId: 'workspace-1', sessionId: 'session-1' }
    const state = {
      thread: null,
      codexThreadId: null,
      model: 'gpt-5.3-codex',
      effort: 'medium',
      plan: false,
      webSocketsEnabled: false,
      formatPrimed: false,
      emittedByItem: new Map<string, string>(),
      lastToolUpdateByItem: new Map<string, { text: string; emittedAt: number }>(),
      collab: {},
      pendingAskUserRequest: null,
    }
    const thread = {
      runStreamed: async () => ({
        events: (async function* () {
          yield {
            type: 'item.completed',
            item: {
              id: 'ask-1',
              type: 'mcp_tool_call',
              server: 'functions',
              tool: 'request_user_input',
              arguments: {
                questions: [
                  {
                    header: 'Scope',
                    question: 'Which path?',
                    options: [{ label: 'A' }, { label: 'B' }],
                  },
                ],
              },
              status: 'completed',
            },
          }
          yield {
            type: 'item.started',
            item: {
              id: 'msg-1',
              type: 'agent_message',
              text: 'I used the request_user_input tool. It returned no selected answer yet.',
            },
          }
        })(),
      }),
    }

    await (
      driver as unknown as {
        runCodexStreamedTurn(
          ctx: unknown,
          state: unknown,
          thread: unknown,
          input: unknown,
          logContext: unknown,
        ): Promise<void>
      }
    ).runCodexStreamedTurn(
      {
        sessionRef,
        workspacePath: '/tmp/workspace',
        signal: new AbortController().signal,
        emit: (event: SessionDriverEvent) => emitted.push(event),
      },
      state,
      thread,
      'prompt',
      {
        model: 'gpt-5.3-codex',
        effort: 'medium',
        seedTranscript: false,
        webSocketsEnabled: false,
      },
    )

    expect(state.pendingAskUserRequest?.request.questions[0]?.question).toBe('Which path?')
    expect(emitted).toEqual([])
  })

  test('suspends the stream when Codex emits request_user_input as a function_call item', async () => {
    const driver = new CodexDriver()
    const emitted: SessionDriverEvent[] = []
    const sessionRef: SessionRef = { workspaceId: 'workspace-1', sessionId: 'session-1' }
    const state = {
      thread: null,
      codexThreadId: null,
      model: 'gpt-5.3-codex',
      effort: 'medium',
      plan: false,
      webSocketsEnabled: false,
      formatPrimed: false,
      emittedByItem: new Map<string, string>(),
      lastToolUpdateByItem: new Map<string, { text: string; emittedAt: number }>(),
      collab: {},
      pendingAskUserRequest: null,
    }
    const thread = {
      runStreamed: async () => ({
        events: (async function* () {
          yield {
            type: 'item.completed',
            item: {
              id: 'call-1',
              type: 'function_call',
              name: 'request_user_input',
              call_id: 'call_native_request_user_input',
              arguments: JSON.stringify({
                questions: [
                  {
                    header: 'Choice',
                    question: 'Pick one?',
                    options: [{ label: 'One' }, { label: 'Two' }],
                  },
                ],
              }),
            },
          }
          yield {
            type: 'item.started',
            item: {
              id: 'msg-1',
              type: 'agent_message',
              text: 'The request_user_input tool returned no answer.',
            },
          }
        })(),
      }),
    }

    await (
      driver as unknown as {
        runCodexStreamedTurn(
          ctx: unknown,
          state: unknown,
          thread: unknown,
          input: unknown,
          logContext: unknown,
        ): Promise<void>
      }
    ).runCodexStreamedTurn(
      {
        sessionRef,
        workspacePath: '/tmp/workspace',
        signal: new AbortController().signal,
        emit: (event: SessionDriverEvent) => emitted.push(event),
      },
      state,
      thread,
      'prompt',
      {
        model: 'gpt-5.3-codex',
        effort: 'medium',
        seedTranscript: false,
        webSocketsEnabled: false,
      },
    )

    expect(state.pendingAskUserRequest?.request.questions[0]?.question).toBe('Pick one?')
    expect(emitted).toEqual([])
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

describe('codexCliSupportsSdkExec', () => {
  test('rejects codex builds that do not understand --experimental-json', () => {
    const homebrewCodex = '/opt/homebrew/bin/codex'
    if (!existsSync(homebrewCodex)) return
    expect(codexCliSupportsSdkExec(homebrewCodex, codexSdkEnv())).toBe(false)
  })

  test('resolveCodexCliPath skips incompatible homebrew shims when bun codex exists', () => {
    const bunCodex = join(homedir(), '.bun', 'bin', 'codex')
    if (!existsSync(bunCodex)) return
    expect(resolveCodexCliPath()).toBe(bunCodex)
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

  test('always enables default-mode request_user_input and conditionally adds WebSockets', () => {
    expect(codexConfigForWebSockets(true)).toEqual({
      features: {
        default_mode_request_user_input: true,
      },
      model_providers: {
        openai: {
          supports_websockets: true,
        },
      },
    })
    expect(codexConfigForWebSockets(false)).toEqual({
      features: {
        default_mode_request_user_input: true,
      },
    })
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

describe('applyCodexToolHook', () => {
  const sessionRef: SessionRef = { workspaceId: 'workspace-1', sessionId: 'session-1' }
  const item = {
    id: 'call-1',
    type: 'mcp_tool_call',
    server: 'assets',
    tool: 'image_gen',
    arguments: { prompt: 'button' },
    status: 'in_progress',
  } as const

  const startedEvent = {
    provider: 'codex',
    phase: 'started',
    callId: item.id,
    toolName: 'assets.image_gen',
    item,
    raw: item,
    workspacePath: '/tmp/project',
    sessionRef,
    input: item.arguments,
    capabilities: AGENT_SDK_HOOK_CAPABILITIES,
  } as const

  test('passes through tool emissions when no hook is registered', () => {
    expect(applyCodexToolHook(startedEvent)).toEqual({
      toolName: 'assets.image_gen',
      input: { prompt: 'button' },
      output: undefined,
      success: undefined,
      diagnostics: undefined,
    })
  })

  test('lets app hooks reshape SDK tool rows for image generation display', () => {
    const emission = applyCodexToolHook(
      startedEvent,
      (event) => ({
        toolName: 'image_gen',
        input: {
          ...(event.input as Record<string, unknown>),
          prompt: `${String((event.input as { prompt?: unknown }).prompt)}, UI asset style`,
        },
      }),
    )

    expect(emission).toEqual({
      toolName: 'image_gen',
      input: { prompt: 'button, UI asset style' },
      output: undefined,
      success: undefined,
      diagnostics: undefined,
    })
  })

  test('lets app hooks suppress noisy tool rows', () => {
    expect(applyCodexToolHook(startedEvent, () => ({ suppress: true }))).toBeNull()
  })

  test('surfaces hook failures as diagnostics without dropping the tool event', () => {
    expect(
      applyCodexToolHook(startedEvent, () => {
        throw new Error('display hook failed')
      }),
    ).toEqual({
      toolName: 'assets.image_gen',
      input: { prompt: 'button' },
      output: undefined,
      success: undefined,
      diagnostics: [{ level: 'error', message: 'display hook failed' }],
    })
  })
})
