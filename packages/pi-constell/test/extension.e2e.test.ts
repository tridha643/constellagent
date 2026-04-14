import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import piConstell from '../extensions/pi-constell.js'
import { getTaskHandoffFileName, getTaskSeedFileName, getWorkspaceTaskManifestPath, getWorkspaceTaskRoot, removeWorkspaceTaskRoot } from '../extensions/task-handoff.js'

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
  const activePath = message.match(/active plan file(?: under ~\/\.pi-constell\/plans\/)?:\s*(.+)$/m)?.[1]?.trim()
  assert.ok(activePath)
  return activePath!
}

test('plan extension registers askUserQuestion and plan commands only', () => {
  const api = new FakeAPI()
  piConstell(api as any)
  assert.ok(api.tools.some((tool) => tool.name === 'askUserQuestion'))
  assert.equal(api.tools.some((tool) => tool.name.startsWith('Task')), false)
  assert.ok(api.commands.has('plan'))
  assert.ok(api.commands.has('plan-off'))
  assert.ok(api.commands.has('agent'))
  assert.equal(api.commands.has('tasks'), false)
})

test('plan mode requires askUserQuestion before plan writing or auto-save', async () => {
  const workspaceId = `pi-constell-e2e-${Date.now()}-prompt`
  const previousWorkspaceId = process.env.AGENT_ORCH_WS_ID
  process.env.AGENT_ORCH_WS_ID = workspaceId
  const cwd = await mkdtemp(join(tmpdir(), 'pi-constell-e2e-'))
  try {
    const api = new FakeAPI()
    piConstell(api as any)
    const ctx = createCtx(cwd)

    await api.commands.get('plan')!.handler('', ctx)
    const [beforeAgentStart] = await emit(api, 'before_agent_start', {
      prompt: 'improve the plan mode questionnaire ux',
    }, ctx)

    const message = beforeAgentStart?.message?.content ?? ''
    assert.match(message, /Use askUserQuestion as the blocking clarification step/)
    assert.match(message, /Durable task handoff files may be written only under ~\/\.pi\/<workspaceId>\/tasks\//)
    assert.match(message, /seed durable handoff metadata and an initial workspace task graph/i)
    assert.doesNotMatch(message, /Use the native task tools/)

    const activePath = extractActivePlanPath(message)
    const blockedPlanWrite = await emit(api, 'tool_call', {
      toolName: 'write',
      input: { path: activePath, content: '# Draft plan' },
    }, ctx)
    assert.equal(blockedPlanWrite[0]?.block, true)
    assert.match(blockedPlanWrite[0]?.reason ?? '', /clarification round/)
  } finally {
    process.env.AGENT_ORCH_WS_ID = previousWorkspaceId
    await removeWorkspaceTaskRoot(workspaceId)
  }
})

test('completed clarification round saves a plan and seeds durable handoff files', async () => {
  const workspaceId = `pi-constell-e2e-${Date.now()}-handoff`
  const previousWorkspaceId = process.env.AGENT_ORCH_WS_ID
  process.env.AGENT_ORCH_WS_ID = workspaceId
  const cwd = await mkdtemp(join(tmpdir(), 'pi-constell-e2e-'))
  const initResult = spawnSync('git', ['init'], { cwd, encoding: 'utf-8' })
  assert.equal(initResult.status, 0)

  try {
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
      prompt: 'split planning and task execution into companion extensions',
    }, ctx)
    const activePath = extractActivePlanPath(beforeAgentStart.message.content)

    const tool = getAskUserQuestionTool(api)
    await tool.execute('tool-call-id', {
      questions: [
        {
          header: 'Scope',
          question: 'What should this plan prioritize?',
          options: [
            { label: 'Hardening', description: 'Recommended: land the product split first.' },
            { label: 'Fast publish', description: 'Keep scope minimal.' },
          ],
        },
      ],
    }, new AbortController().signal, () => {}, ctx)

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
            { type: 'text', text: `# Split Planning And Task Execution

## Open Questions / Assumptions
- Scope: Hardening.

## Phases
### Phase 1
- Goal: Slim the planning package to plan-only responsibilities.
- Why this phase boundary is good: It stabilizes the planner contract before extraction.
- Main code areas likely to change: packages/pi-constell/extensions.
- Task breakdown: Remove runtime task ownership and write durable handoff metadata.
- Unit tests: Verify plan-only command/tool registration and handoff seeding.
- E2E validation: Save a plan and assert handoff files exist.
- Storage/runtime verification: Confirm only ~/.pi/<workspaceId>/tasks/ is used for the handoff.

### Phase 2
- Goal: Create the companion task extension package.
- Why this phase boundary is good: It gives implementation-time runtime and UI a clean owner.
- Main code areas likely to change: packages/pi-constell-tasks.
- Task breakdown: Move Task* tools, /tasks, and implementation-time injection to the companion package.
- Unit tests: Add cross-instance pickup coverage.
- E2E validation: Planner instance seeds handoff, then implementer instance reads it.
- Storage/runtime verification: Confirm only file-backed workspace mode is a supported handoff path.

## Recommendation
- Start with Phase 1.` },
          ],
        },
      ],
    }, ctx)

    const successNotice = ctx._notifications.find((message: string) => message.includes('saved plan'))
    assert.ok(successNotice)
    const savedPath = successNotice!.split(': ').pop()!
    assert.match(savedPath, new RegExp(`^${homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.pi-constell/plans/`))
    const saved = await readFile(savedPath, 'utf-8')
    assert.match(saved, /# Split Planning And Task Execution/)

    const taskRoot = getWorkspaceTaskRoot(workspaceId)
    const manifestPath = getWorkspaceTaskManifestPath(workspaceId)
    const seedFilePath = join(taskRoot, getTaskSeedFileName())
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
    const seed = JSON.parse(await readFile(seedFilePath, 'utf-8'))

    assert.equal(manifest.plan.path, savedPath)
    assert.equal(manifest.plan.title, 'Split Planning And Task Execution')
    assert.equal(manifest.seed.taskFile, seedFilePath)
    assert.equal(seed.tasks.length, 2)
    assert.equal(seed.tasks[0]?.blocks?.[0], '2')
    assert.equal(seed.tasks[1]?.blockedBy?.[0], '1')
    assert.equal(seed.tasks[0]?.metadata?.planPath, savedPath)

    const exclude = await readFile(join(cwd, '.git', 'info', 'exclude'), 'utf-8')
    assert.doesNotMatch(exclude, /\.pi-constell\/plans\//)
  } finally {
    process.env.AGENT_ORCH_WS_ID = previousWorkspaceId
    await removeWorkspaceTaskRoot(workspaceId)
  }
})
