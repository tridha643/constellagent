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
import { createCodexAppServerEventMapperState } from './codex-app-server-events'
import { createCodexCollabSessionState } from './codex-driver-collab'
import { getConductorQuestionBridge } from './conductor-question-bridge'

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

describe('CodexDriver app-server transport', () => {
  test('routes Codex turns through codex app-server turn/start', () => {
    const source = readFileSync(new URL('./codex-driver.ts', import.meta.url), 'utf8')
    expect(source).toContain("request('turn/start'")
    expect(source).not.toContain('thread.runStreamed')
  })

  test('streams inline canvas text through assistant deltas', () => {
    const source = readFileSync(new URL('./codex-driver.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('outputSchema: renderJsonCanvasOutputSchema()')
    expect(source).not.toContain('upsertSyntheticCanvasFromText')
    expect(source).toContain('evAssistantDelta')
  })

  test('resolves item/tool/requestUserInput with structured answers', async () => {
    const driver = new CodexDriver()
    const emitted: SessionDriverEvent[] = []
    const sessionRef: SessionRef = { workspaceId: 'workspace-1', sessionId: 'session-1' }
    const state = {
      thread: { threadId: 'thread-1' },
      codexThreadId: 'thread-1',
      activeTurnId: 'turn-1',
      model: 'gpt-5.3-codex',
      effort: 'medium',
      plan: false,
      webSocketsEnabled: false,
      formatPrimed: false,
      emittedByItem: new Map<string, string>(),
      lastToolUpdateByItem: new Map<string, { text: string; emittedAt: number }>(),
      collab: createCodexCollabSessionState(),
    }
    const controller = new AbortController()
    ;(driver as unknown as { activeTurnsByThread: Map<string, unknown> }).activeTurnsByThread.set(
      'thread-1',
      {
        ctx: {
          sessionRef,
          workspacePath: '/tmp/workspace',
          signal: controller.signal,
          emit: (event: SessionDriverEvent) => emitted.push(event),
        },
        state,
        mapper: createCodexAppServerEventMapperState(),
        completion: { markCompleted() {}, markFailed() {} },
      },
    )

    const bridge = getConductorQuestionBridge()
    let requestId = ''
    bridge.setHostNotifier((question) => {
      requestId = question.requestId
    })
    const pending = (
      driver as unknown as {
        resolveAppServerRequestUserInput(params: unknown): Promise<unknown>
      }
    ).resolveAppServerRequestUserInput({
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      questions: [
        {
          id: 'scope-q',
          header: 'Scope',
          question: 'Which path?',
          options: [{ label: 'A', description: '' }, { label: 'B', description: '' }],
        },
      ],
    })
    await Promise.resolve()
    expect(requestId).not.toBe('')
    bridge.resolve(requestId, {
      cancelled: false,
      answers: [
        {
          header: 'Scope',
          question: 'Which path?',
          answer: 'A',
          wasCustom: false,
          selectedOptions: ['A'],
        },
      ],
    })

    await expect(pending).resolves.toEqual({
      answers: {
        'scope-q': { answers: ['A'] },
      },
    })
    expect(emitted.map((event) => event.type)).toEqual(['toolStarted', 'toolFinished'])
  })
})

describe('CodexDriver concurrent turn routing', () => {
  function makeTurn(workspaceId: string, sessionId: string, threadId: string) {
    const emitted: SessionDriverEvent[] = []
    const completions: string[] = []
    const controller = new AbortController()
    return {
      emitted,
      completions,
      turn: {
        ctx: {
          sessionRef: { workspaceId, sessionId } satisfies SessionRef,
          workspacePath: '/tmp/workspace',
          signal: controller.signal,
          emit: (event: SessionDriverEvent) => emitted.push(event),
        },
        state: {
          thread: { threadId },
          codexThreadId: threadId,
          activeTurnId: null,
          model: 'gpt-5.3-codex',
          effort: 'medium',
          plan: false,
          webSocketsEnabled: false,
          formatPrimed: true,
          emittedByItem: new Map<string, string>(),
          lastToolUpdateByItem: new Map<string, { text: string; emittedAt: number }>(),
          collab: createCodexCollabSessionState(),
        },
        mapper: createCodexAppServerEventMapperState(),
        completion: {
          markCompleted: () => completions.push('completed'),
          markFailed: () => completions.push('failed'),
        },
      },
    }
  }

  test('routes notifications to the turn owning the threadId, not the latest turn', () => {
    const driver = new CodexDriver()
    const a = makeTurn('workspace-1', 'session-a', 'thread-a')
    const b = makeTurn('workspace-1', 'session-b', 'thread-b')
    const turns = (driver as unknown as { activeTurnsByThread: Map<string, unknown> }).activeTurnsByThread
    turns.set('thread-a', a.turn)
    turns.set('thread-b', b.turn)
    const notify = (
      driver as unknown as { handleAppServerNotification(method: string, params: unknown): void }
    ).handleAppServerNotification.bind(driver)

    notify('item/agentMessage/delta', {
      threadId: 'thread-a',
      turnId: 'turn-a',
      itemId: 'msg-a',
      delta: 'from chat A',
    })
    notify('item/agentMessage/delta', {
      threadId: 'thread-b',
      turnId: 'turn-b',
      itemId: 'msg-b',
      delta: 'from chat B',
    })

    const aDeltas = a.emitted.filter((event) => event.type === 'assistantDelta')
    const bDeltas = b.emitted.filter((event) => event.type === 'assistantDelta')
    expect(aDeltas).toHaveLength(1)
    expect(bDeltas).toHaveLength(1)
    expect((aDeltas[0] as { text: string }).text).toBe('from chat A')
    expect((bDeltas[0] as { text: string }).text).toBe('from chat B')
    expect(aDeltas.every((event) => event.sessionRef.sessionId === 'session-a')).toBe(true)
    expect(bDeltas.every((event) => event.sessionRef.sessionId === 'session-b')).toBe(true)
  })

  test('turn/completed for one thread does not complete the other turn', () => {
    const driver = new CodexDriver()
    const a = makeTurn('workspace-1', 'session-a', 'thread-a')
    const b = makeTurn('workspace-1', 'session-b', 'thread-b')
    const turns = (driver as unknown as { activeTurnsByThread: Map<string, unknown> }).activeTurnsByThread
    turns.set('thread-a', a.turn)
    turns.set('thread-b', b.turn)
    const notify = (
      driver as unknown as { handleAppServerNotification(method: string, params: unknown): void }
    ).handleAppServerNotification.bind(driver)

    notify('turn/completed', { threadId: 'thread-a', turn: { id: 'turn-a', status: 'completed' } })

    expect(a.completions).toEqual(['completed'])
    expect(b.completions).toEqual([])
  })

  test('drops unattributable notifications when several turns are in flight', () => {
    const driver = new CodexDriver()
    const a = makeTurn('workspace-1', 'session-a', 'thread-a')
    const b = makeTurn('workspace-1', 'session-b', 'thread-b')
    const turns = (driver as unknown as { activeTurnsByThread: Map<string, unknown> }).activeTurnsByThread
    turns.set('thread-a', a.turn)
    turns.set('thread-b', b.turn)
    const notify = (
      driver as unknown as { handleAppServerNotification(method: string, params: unknown): void }
    ).handleAppServerNotification.bind(driver)

    notify('item/agentMessage/delta', { itemId: 'msg-x', delta: 'no thread id' })

    expect(a.emitted).toHaveLength(0)
    expect(b.emitted).toHaveLength(0)
  })

  test('falls back to the sole active turn for payloads without a threadId', () => {
    const driver = new CodexDriver()
    const a = makeTurn('workspace-1', 'session-a', 'thread-a')
    const turns = (driver as unknown as { activeTurnsByThread: Map<string, unknown> }).activeTurnsByThread
    turns.set('thread-a', a.turn)
    const notify = (
      driver as unknown as { handleAppServerNotification(method: string, params: unknown): void }
    ).handleAppServerNotification.bind(driver)

    notify('item/agentMessage/delta', { itemId: 'msg-a', delta: 'single turn' })

    const deltas = a.emitted.filter((event) => event.type === 'assistantDelta')
    expect(deltas).toHaveLength(1)
    expect((deltas[0] as { text: string }).text).toBe('single turn')
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
  test('returns plain text input when no image paths exist', () => {
    expect(buildCodexUserInput('hello', [])).toEqual([{ type: 'text', text: 'hello' }])
  })

  test('builds structured text plus localImage input for app-server turns', () => {
    expect(buildCodexUserInput('look', ['/tmp/a.png'])).toEqual([
      { type: 'text', text: 'look' },
      { type: 'localImage', path: '/tmp/a.png' },
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
