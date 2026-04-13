import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import piConstell from '../extensions/pi-constell.js'

type Handler = (event: any, ctx: any) => any

type CustomQuestionResult = {
  cancelled: boolean
  answers: Array<{
    question: string
    header: string
    answer: string | string[]
    wasCustom: boolean
    selectedOptions: string[]
    details?: string
  }>
}

class FakeAPI {
  tools: any[] = []
  commands = new Map<string, any>()
  flags = new Map<string, unknown>()
  events = new Map<string, Handler[]>()
  activeTools = ['read', 'bash', 'edit', 'write']
  entries: Array<{ type: string; customType: string; data: unknown }> = []

  registerTool(tool: any): void { this.tools.push(tool) }
  registerCommand(name: string, command: any): void { this.commands.set(name, command) }
  registerFlag(name: string, flag: any): void { this.flags.set(name, flag.default) }
  on(name: string, handler: Handler): void {
    const handlers = this.events.get(name) ?? []
    handlers.push(handler)
    this.events.set(name, handlers)
  }
  getFlag(name: string): unknown { return this.flags.get(name) }
  getActiveTools(): string[] { return [...this.activeTools] }
  setActiveTools(names: string[]): void { this.activeTools = [...names] }
  appendEntry(customType: string, data: unknown): void { this.entries.push({ type: 'custom', customType, data }) }
}

function createCtx(cwd: string, entries: any[] = [], customQuestionResult: CustomQuestionResult = { cancelled: true, answers: [] }) {
  const notifications: string[] = []
  const statuses = new Map<string, string | undefined>()
  return {
    cwd,
    hasUI: true,
    model: { provider: 'anthropic', id: 'claude-sonnet-4-5' },
    ui: {
      theme: {
        fg: (_name: string, text: string) => text,
      },
      notify: (message: string) => { notifications.push(message) },
      setStatus: (name: string, text?: string) => { statuses.set(name, text) },
      custom: async () => customQuestionResult,
    },
    sessionManager: {
      getEntries: () => entries,
    },
    _notifications: notifications,
    _statuses: statuses,
  }
}

async function emit(api: FakeAPI, name: string, event: any, ctx: any) {
  const handlers = api.events.get(name) ?? []
  const results = []
  for (const handler of handlers) results.push(await handler(event, ctx))
  return results
}

function getAskUserQuestionTool(api: FakeAPI): any {
  const tool = api.tools.find((candidate) => candidate.name === 'askUserQuestion')
  assert.ok(tool)
  return tool
}

function extractActivePlanPath(message: string): string {
  const activePath = message.split('active plan file: ')[1]?.split('\n')[0]
  assert.ok(activePath)
  return activePath!
}

test('extension registers askUserQuestion and plan command', () => {
  const api = new FakeAPI()
  piConstell(api as any)
  assert.ok(api.tools.some((tool) => tool.name === 'askUserQuestion'))
  assert.ok(api.commands.has('plan'))
})

test('plan mode requires askUserQuestion before plan writing or auto-save', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-constell-e2e-'))
  const api = new FakeAPI()
  piConstell(api as any)
  const ctx = createCtx(cwd)

  await api.commands.get('plan')!.handler('', ctx)
  const [beforeAgentStart] = await emit(api, 'before_agent_start', {
    prompt: 'improve the plan mode questionnaire ux',
  }, ctx)

  const message = beforeAgentStart?.message?.content ?? ''
  assert.match(message, /Your first substantive action must be askUserQuestion/)
  assert.match(message, /Ask exactly one clarification question per askUserQuestion call/)
  assert.match(message, /## Proposed PR Stack/)

  const activePath = extractActivePlanPath(message)
  const blockedPlanWrite = await emit(api, 'tool_call', {
    toolName: 'write',
    input: { path: activePath, content: '# Draft plan' },
  }, ctx)
  assert.equal(blockedPlanWrite[0]?.block, true)
  assert.match(blockedPlanWrite[0]?.reason ?? '', /clarification round/)

  await emit(api, 'agent_end', {
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: `# Improve plan mode questionnaire UX

## Open Questions / Assumptions
- None.

## Proposed PR Stack
1. Phase 1 / PR 1
- Goal: Tighten the planner.
- Why this is a good PR boundary: It is focused.
- Main code areas likely to change: extensions.
- Unit tests: Add coverage.
- E2E validation: Run verify.
- DB verification: N/A.
- Linear: 1 ticket.

## Recommendation
- Start with Phase 1.` },
        ],
      },
    ],
  }, ctx)

  assert.equal(ctx._notifications.some((message: string) => message.includes('saved plan')), false)
  assert.ok(ctx._notifications.some((message: string) => message.includes('askUserQuestion must complete first')))
})

test('completed clarification round opens the gate and keeps plan files out of git status', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-constell-e2e-'))
  const initResult = spawnSync('git', ['init'], { cwd, encoding: 'utf-8' })
  assert.equal(initResult.status, 0)

  const api = new FakeAPI()
  piConstell(api as any)
  const ctx = createCtx(cwd, [], {
    cancelled: false,
    answers: [
      {
        question: 'What should this plan prioritize?',
        header: 'Scope',
        answer: 'Hardening',
        wasCustom: false,
        selectedOptions: ['Hardening'],
      },
    ],
  })

  await api.commands.get('plan')!.handler('', ctx)
  const [beforeAgentStart] = await emit(api, 'before_agent_start', {
    prompt: 'improve the plan mode questionnaire ux',
  }, ctx)
  const activePath = extractActivePlanPath(beforeAgentStart.message.content)

  const tool = getAskUserQuestionTool(api)
  const result = await tool.execute('tool-call-id', {
    questions: [
      {
        header: 'Scope',
        question: 'What should this plan prioritize?',
        options: [
          { label: 'Hardening', description: 'Recommended: tighten the guardrails first.' },
          { label: 'Fast publish', description: 'Keep scope minimal.' },
        ],
      },
    ],
  }, new AbortController().signal, () => {}, ctx)
  assert.match(result.content[0]?.text ?? '', /Scope: Hardening/)

  const allowedPlanWrite = await emit(api, 'tool_call', {
    toolName: 'write',
    input: { path: activePath, content: '# Draft plan' },
  }, ctx)
  assert.equal(allowedPlanWrite[0], undefined)

  await emit(api, 'agent_end', {
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: `# Improve plan mode questionnaire UX

## Open Questions / Assumptions
- Scope: Hardening.

## Proposed PR Stack
1. Phase 1 / PR 1
- Goal: Enforce a clarification gate.
- Why this is a good PR boundary: It lands the core safety behavior first.
- Main code areas likely to change: extensions, tests, docs.
- Unit tests: Add coverage for write blocking and prompt instructions.
- E2E validation: Run package verify and confirm askUserQuestion is mandatory.
- DB verification: N/A.
- Linear: 1 ticket.

## Recommendation
- Start with Phase 1.` },
        ],
      },
    ],
  }, ctx)

  const successNotice = ctx._notifications.find((message: string) => message.includes('saved plan'))
  assert.ok(successNotice)
  const savedPath = successNotice.split(': ').pop()!
  const saved = await readFile(savedPath, 'utf-8')
  assert.match(saved, /# Improve plan mode questionnaire UX/)

  const exclude = await readFile(join(cwd, '.git', 'info', 'exclude'), 'utf-8')
  assert.match(exclude, /\.pi-constell\/plans\//)

  const status = spawnSync('git', ['status', '--short'], { cwd, encoding: 'utf-8' })
  assert.equal(status.status, 0)
  assert.doesNotMatch(String(status.stdout), /\.pi-constell\/plans/)
})
