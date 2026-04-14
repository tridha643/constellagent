import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
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
    optionMappings?: Array<{ letter: string; index: number; label: string }>
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

test('extension registers askUserQuestion and plan mode commands', () => {
  const api = new FakeAPI()
  piConstell(api as any)
  assert.ok(api.tools.some((tool) => tool.name === 'askUserQuestion'))
  assert.ok(api.commands.has('plan'))
  assert.ok(api.commands.has('plan-off'))
  assert.ok(api.commands.has('agent'))
  assert.ok(api.commands.has('plan-save'))
})

test('plan mode allows help commands but still blocks mutating shell commands', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-constell-e2e-'))
  const api = new FakeAPI()
  piConstell(api as any)
  const ctx = createCtx(cwd)

  await api.commands.get('plan')!.handler('', ctx)

  const [allowedHelp] = await emit(api, 'tool_call', {
    toolName: 'bash',
    input: { command: 'pi -h' },
  }, ctx)
  assert.equal(allowedHelp, undefined)

  const [blockedMutating] = await emit(api, 'tool_call', {
    toolName: 'bash',
    input: { command: 'pi /plan' },
  }, ctx)
  assert.equal(blockedMutating?.block, true)
  assert.match(blockedMutating?.reason ?? '', /read-only shell commands/)
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
  assert.match(message, /Start with 3-4 strong clarification questions/)
  assert.match(message, /Read-only help commands are allowed in plan mode/)
  assert.match(message, /\/plan-off or \/agent/)
  assert.match(message, /## Phases/)
  assert.match(message, /Write the full phase plan now/)
  assert.match(message, /detailed without becoming overbearing/)

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

## Phases

### Phase 1
Goal: Tighten the planner.

Why this phase boundary makes sense: It is focused.

Main code areas:
- extensions

Task breakdown:
- Add coverage.

Tests:
- Run verify.

How I'll validate:
- Check the plan file saves correctly.

### Phase 2
Goal: Verify the app opens the saved plan cleanly.

Why this phase boundary makes sense: Discovery is separate from the plan-writing contract.

Main code areas:
- desktop

Task breakdown:
- Confirm the plan appears in the app.

Tests:
- Run the focused desktop plan test.

How I'll validate:
- Open the saved plan from ~/.pi-constell/plans.

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
        optionMappings: [
          { letter: 'A', index: 1, label: 'Hardening' },
          { letter: 'B', index: 2, label: 'Fast publish' },
        ],
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
  assert.match(result.content[0]?.text ?? '', /Scope: Hardening \(choices: A\/1=Hardening, B\/2=Fast publish\)/)

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

## Phases

### Phase 1
Goal: Enforce a clarification gate.

Why this phase boundary makes sense: It lands the core safety behavior first.

Main code areas:
- extensions
- tests
- docs

Task breakdown:
- Add coverage for write blocking and prompt instructions.

Tests:
- Run package verify and confirm askUserQuestion is mandatory.

How I'll validate:
- Confirm the plan is saved under ~/.pi-constell/plans.

### Phase 2
Goal: Confirm later phases remain visible in the app.

Why this phase boundary makes sense: Preview rendering should show the full saved plan.

Main code areas:
- desktop

Task breakdown:
- Open the saved PI plan in preview.

Tests:
- Run the PI Constell desktop e2e.

How I'll validate:
- Confirm Phase 2 renders after Phase 1.

## Recommendation
- Start with Phase 1.` },
        ],
      },
    ],
  }, ctx)

  const successNotice = ctx._notifications.find((message: string) => message.includes('saved plan'))
  assert.ok(successNotice)
  const savedPath = successNotice.split(': ').pop()!
  assert.match(savedPath, new RegExp(`^${homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.pi-constell/plans/`))
  const saved = await readFile(savedPath, 'utf-8')
  assert.match(saved, /# Improve plan mode questionnaire UX/)

  const exclude = await readFile(join(cwd, '.git', 'info', 'exclude'), 'utf-8')
  assert.doesNotMatch(exclude, /\.pi-constell\/plans\//)

  const status = spawnSync('git', ['status', '--short'], { cwd, encoding: 'utf-8' })
  assert.equal(status.status, 0)
  assert.doesNotMatch(String(status.stdout), /\.pi-constell\/plans/)
})
