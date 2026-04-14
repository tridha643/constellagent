import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import piConstellTasks from '../extensions/pi-constell-tasks.js'
import { getWorkspaceTaskManifestPath, getWorkspaceTaskRoot } from '../extensions/tasks/handoff.js'
import { removeWorkspaceTaskRoot, saveTasksConfig } from '../extensions/tasks/task-store.js'

type Handler = (event: any, ctx: any) => any

class FakeAPI {
  tools: any[] = []
  commands = new Map<string, any>()
  events = new Map<string, Handler[]>()
  activeTools = ['read', 'bash', 'edit', 'write']

  registerTool(tool: any): void { this.tools.push(tool) }
  registerCommand(name: string, command: any): void { this.commands.set(name, command) }
  on(name: string, handler: Handler): void {
    const handlers = this.events.get(name) ?? []
    handlers.push(handler)
    this.events.set(name, handlers)
  }
  getActiveTools(): string[] { return [...this.activeTools] }
  setActiveTools(names: string[]): void { this.activeTools = [...names] }
}

function createCtx(cwd: string) {
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
    },
    sessionManager: {
      getEntries: () => [],
    },
    _notifications: notifications,
    _statuses: statuses,
  }
}

async function emit(api: FakeAPI, name: string, event: any, ctx: any) {
  const handlers = api.events.get(name) ?? []
  const results: any[] = []
  for (const handler of handlers) results.push(await handler(event, ctx))
  return results
}

function getTool(api: FakeAPI, name: string): any {
  const tool = api.tools.find((candidate) => candidate.name === name)
  assert.ok(tool)
  return tool
}

test('task extension registers Task* tools and the /tasks command and activates them in normal mode', async () => {
  const api = new FakeAPI()
  piConstellTasks(api as any)
  const ctx = createCtx('/tmp/pi-constell-tasks')
  await emit(api, 'session_start', {}, ctx)

  assert.ok(api.tools.some((tool) => tool.name === 'TaskCreate'))
  assert.ok(api.tools.some((tool) => tool.name === 'TaskExecute'))
  assert.ok(api.commands.has('tasks'))
  assert.ok(api.activeTools.includes('TaskCreate'))
  assert.ok(api.activeTools.includes('TaskExecute'))
})

test('before_agent_start injects the stored plan reference and shared task summary', async () => {
  const workspaceId = `pi-constell-tasks-e2e-${Date.now()}-handoff`
  const previousWorkspaceId = process.env.AGENT_ORCH_WS_ID
  process.env.AGENT_ORCH_WS_ID = workspaceId
  const cwd = await mkdtemp(join(tmpdir(), 'pi-constell-tasks-e2e-'))
  const planPath = join(cwd, 'saved-plan.md')

  try {
    const api = new FakeAPI()
    piConstellTasks(api as any)
    const ctx = createCtx(cwd)

    await writeFile(planPath, `# Saved Plan

## Phases
### Phase 1
- Goal: Implement the feature.`,
    'utf-8')

    const taskRoot = getWorkspaceTaskRoot(workspaceId)
    await mkdir(taskRoot, { recursive: true })
    await writeFile(join(taskRoot, 'tasks.json'), `${JSON.stringify({
      schemaVersion: 1,
      nextId: 2,
      tasks: [{
        id: '1',
        subject: 'Phase 1: Implement the feature',
        description: 'Use the stored plan.',
        status: 'pending',
        metadata: { planPath },
        blocks: [],
        blockedBy: [],
        output: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }],
    }, null, 2)}\n`, 'utf-8')
    await writeFile(getWorkspaceTaskManifestPath(workspaceId), `${JSON.stringify({
      schemaVersion: 1,
      plan: {
        path: planPath,
        title: 'Saved Plan',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        codingAgent: 'anthropic/test',
        prompt: 'ship it',
        clarifications: 'Scope: hardening',
      },
      seed: {
        taskFile: join(taskRoot, 'tasks.json'),
        taskCount: 1,
        source: 'phase-headings',
        preservedExistingTasks: false,
      },
    }, null, 2)}\n`, 'utf-8')

    const [result]: any[] = await emit(api, 'before_agent_start', { prompt: 'implement the stored plan' }, ctx)
    const message = result?.message?.content ?? ''
    assert.match(message, /\[PI CONSTELL TASKS ACTIVE\]/)
    assert.match(message, /Stored plan reference: Saved Plan/)
    assert.match(message, /Current task store:/)
    assert.match(message, /Stored plan excerpt:/)
    assert.match(message, /Phase 1: Implement the feature/)
  } finally {
    process.env.AGENT_ORCH_WS_ID = previousWorkspaceId
    await removeWorkspaceTaskRoot(workspaceId)
  }
})

test('TaskExecute and TaskOutput work in normal mode and auto-cascade newly unblocked tasks', async () => {
  const workspaceId = `pi-constell-tasks-e2e-${Date.now()}-cascade`
  const previousWorkspaceId = process.env.AGENT_ORCH_WS_ID
  process.env.AGENT_ORCH_WS_ID = workspaceId
  const cwd = await mkdtemp(join(tmpdir(), 'pi-constell-tasks-e2e-'))

  try {
    const api = new FakeAPI()
    piConstellTasks(api as any)
    const ctx = createCtx(cwd)
    await saveTasksConfig({ workspaceId, sessionId: 'session-1', cwd }, { autoCascade: true })

    const createTool = getTool(api, 'TaskCreate')
    const updateTool = getTool(api, 'TaskUpdate')
    const executeTool = getTool(api, 'TaskExecute')
    const outputTool = getTool(api, 'TaskOutput')

    await createTool.execute('tool-call-id', {
      subject: 'Run first task',
      description: 'Seed the dependency chain.',
      metadata: { command: 'node -e "process.stdout.write(\'first-done\')"' },
    }, new AbortController().signal, () => {}, ctx)
    await createTool.execute('tool-call-id', {
      subject: 'Run second task',
      description: 'Should auto-start after task #1 completes.',
      metadata: { command: 'node -e "process.stdout.write(\'second-done\')"' },
    }, new AbortController().signal, () => {}, ctx)
    await updateTool.execute('tool-call-id', {
      taskId: '1',
      addBlocks: ['2'],
    }, new AbortController().signal, () => {}, ctx)

    await executeTool.execute('tool-call-id', {
      task_ids: ['1'],
    }, new AbortController().signal, () => {}, ctx)

    const firstOutput = await outputTool.execute('tool-call-id', {
      task_id: '1',
      block: true,
      timeout: 2000,
    }, new AbortController().signal, () => {}, ctx)
    assert.match(firstOutput.content[0]?.text ?? '', /first-done/)
    assert.match(firstOutput.content[0]?.text ?? '', /Auto-cascade started #2/)

    const secondOutput = await outputTool.execute('tool-call-id', {
      task_id: '2',
      block: true,
      timeout: 2000,
    }, new AbortController().signal, () => {}, ctx)
    assert.match(secondOutput.content[0]?.text ?? '', /second-done/)

    const stored = JSON.parse(await readFile(join(getWorkspaceTaskRoot(workspaceId), 'tasks.json'), 'utf-8'))
    assert.equal(stored.tasks.length, 2)
  } finally {
    process.env.AGENT_ORCH_WS_ID = previousWorkspaceId
    await removeWorkspaceTaskRoot(workspaceId)
  }
})
