import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  getWorkspaceTaskRoot,
  loadTasksConfig,
  removeWorkspaceTaskRoot,
  resolveTaskStore,
  saveTasksConfig,
  TaskStore,
} from '../extensions/tasks/task-store.js'

function createContext(name: string, sessionId = 'session-1') {
  const workspaceId = `pi-constell-tasks-store-${Date.now()}-${name}`
  return {
    workspaceId,
    sessionId,
    cwd: '/tmp/pi-constell-tasks-store',
  }
}

test('resolveTaskStore returns a workspace-scoped task file by default', async () => {
  const context = createContext('default')
  const previous = process.env.PI_TASKS
  delete process.env.PI_TASKS
  try {
    const resolved = await resolveTaskStore(context)
    assert.equal(resolved.mode, 'file')
    assert.equal(resolved.rootPath, getWorkspaceTaskRoot(context.workspaceId))
    assert.equal(resolved.filePath, join(getWorkspaceTaskRoot(context.workspaceId), 'tasks.json'))
  } finally {
    process.env.PI_TASKS = previous
    await removeWorkspaceTaskRoot(context.workspaceId)
  }
})

test('TaskStore creates, links, updates, and clears tasks', async () => {
  const context = createContext('crud')
  const store = new TaskStore(await resolveTaskStore(context))
  try {
    await store.clearAll()

    const first = await store.create({
      subject: 'First task',
      description: 'Seed the workspace task store.',
    })
    const second = await store.create({
      subject: 'Second task',
      description: 'Depends on the first task.',
    })

    const updated = await store.update({
      taskId: first.id,
      status: 'in_progress',
      addBlocks: [second.id],
    })
    assert.equal(updated.task?.status, 'in_progress')
    assert.equal(updated.warnings.length, 0)

    const listed = await store.list()
    const secondTask = listed.find((task) => task.id === second.id)
    assert.deepEqual(secondTask?.blockedBy, [first.id])

    await store.appendOutput(first.id, 'hello world\n')
    const firstTask = await store.get(first.id)
    assert.match(firstTask?.output.join('') ?? '', /hello world/)

    await store.update({ taskId: first.id, status: 'completed' })
    const removed = await store.clearCompleted()
    assert.equal(removed, 1)
    assert.equal((await store.list()).length, 1)
  } finally {
    await removeWorkspaceTaskRoot(context.workspaceId)
  }
})

test('TaskStore persists settings and session-scoped overrides under the workspace root', async () => {
  const context = createContext('session')
  try {
    await saveTasksConfig(context, {
      taskScope: 'session',
      autoCascade: true,
      autoClearCompleted: 'on_list_complete',
    })
    const config = await loadTasksConfig(context)
    assert.equal(config.taskScope, 'session')
    assert.equal(config.autoCascade, true)
    assert.equal(config.autoClearCompleted, 'on_list_complete')

    const resolved = await resolveTaskStore(context)
    assert.match(resolved.filePath ?? '', /tasks-session-1\.json$/)
    const configPath = join(getWorkspaceTaskRoot(context.workspaceId), 'config.json')
    const raw = await readFile(configPath, 'utf-8')
    assert.match(raw, /"taskScope": "session"/)
  } finally {
    await removeWorkspaceTaskRoot(context.workspaceId)
  }
})

test('TaskStore warns on self, missing, and cyclic links and cleans dependency edges on delete', async () => {
  const context = createContext('warnings')
  const store = new TaskStore(await resolveTaskStore(context))
  try {
    const first = await store.create({ subject: 'First', description: 'First task.' })
    const second = await store.create({ subject: 'Second', description: 'Second task.' })

    const selfLink = await store.update({ taskId: first.id, addBlocks: [first.id] })
    assert.match(selfLink.warnings[0]?.message ?? '', /cannot depend on itself/i)

    const missingLink = await store.update({ taskId: first.id, addBlocks: ['999'] })
    assert.match(missingLink.warnings[0]?.message ?? '', /does not exist/i)

    const validLink = await store.update({ taskId: first.id, addBlocks: [second.id] })
    assert.equal(validLink.warnings.length, 0)

    const cycleLink = await store.update({ taskId: second.id, addBlocks: [first.id] })
    assert.match(cycleLink.warnings[0]?.message ?? '', /would create a cycle/i)

    await store.update({ taskId: first.id, status: 'deleted' })
    const remaining = await store.get(second.id)
    assert.deepEqual(remaining?.blockedBy ?? [], [])
  } finally {
    await removeWorkspaceTaskRoot(context.workspaceId)
  }
})

test('TaskStore honors persisted memory scope and keeps in-memory state across store instances in the same session', async () => {
  const context = createContext('memory')
  try {
    await saveTasksConfig(context, { taskScope: 'memory' })
    const resolved = await resolveTaskStore(context)
    assert.equal(resolved.mode, 'memory')
    assert.equal(resolved.filePath, null)

    const firstStore = new TaskStore(resolved)
    const secondStore = new TaskStore(resolved)
    await firstStore.create({ subject: 'Ephemeral task', description: 'Keep this in memory only.' })
    const listed = await secondStore.list()
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.subject, 'Ephemeral task')
  } finally {
    await removeWorkspaceTaskRoot(context.workspaceId)
  }
})

test('resolveTaskStore fails clearly when workspaceId is unavailable', async () => {
  const context = createContext('missing')
  await assert.rejects(
    resolveTaskStore({ ...context, workspaceId: null }),
    /AGENT_ORCH_WS_ID/,
  )
  await removeWorkspaceTaskRoot(context.workspaceId)
})
