import test from 'node:test'
import assert from 'node:assert/strict'
import { maybeAutoClear, beginTurn, defaultRuntimeState, maybeTaskReminder, recordTaskToolUse } from '../extensions/tasks/runtime.js'
import { resolveTaskStore, TaskStore, removeWorkspaceTaskRoot } from '../extensions/tasks/task-store.js'

const workspaceId = `pi-constell-tasks-runtime-${Date.now()}`
const context = {
  workspaceId,
  sessionId: 'runtime-session',
  cwd: '/tmp/pi-constell-tasks-runtime',
}

test.after(async () => {
  await removeWorkspaceTaskRoot(workspaceId)
})

test('maybeTaskReminder injects only after enough turns without task tool usage', async () => {
  const store = new TaskStore(await resolveTaskStore(context))
  await store.clearAll()
  await store.create({ subject: 'Reminder task', description: 'Track reminder cadence.' })

  const runtime = defaultRuntimeState()
  beginTurn(runtime)
  assert.equal(maybeTaskReminder(await store.readStore(), runtime), null)
  beginTurn(runtime)
  beginTurn(runtime)
  beginTurn(runtime)
  assert.match(maybeTaskReminder(await store.readStore(), runtime) ?? '', /Task reminder:/)
  recordTaskToolUse(runtime)
  assert.equal(maybeTaskReminder(await store.readStore(), runtime), null)
})

test('maybeAutoClear removes completed tasks after the configured delay', async () => {
  const store = new TaskStore(await resolveTaskStore(context))
  await store.clearAll()
  const first = await store.create({ subject: 'Older completed task', description: 'Remove me first.' })
  const second = await store.create({ subject: 'Newer completed task', description: 'Remove me later.' })
  await store.update({ taskId: first.id, status: 'completed' })
  await store.update({ taskId: second.id, status: 'completed' })

  const runtime = defaultRuntimeState()
  for (let index = 0; index < 5; index += 1) beginTurn(runtime)
  runtime.completedTurnByTaskId = { [first.id]: 1, [second.id]: 4 }

  const removed = await maybeAutoClear(store, runtime, 'on_task_complete')
  assert.equal(removed, 1)
  const remaining = await store.list()
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0]?.id, second.id)
})
