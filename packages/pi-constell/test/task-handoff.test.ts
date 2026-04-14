import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { getTaskHandoffFileName, getTaskSeedFileName, getWorkspaceTaskManifestPath, getWorkspaceTaskRoot, removeWorkspaceTaskRoot, writeTaskHandoff } from '../extensions/task-handoff.js'

test('writeTaskHandoff seeds phase-derived workspace tasks and a durable manifest', async () => {
  const workspaceId = `pi-constell-handoff-${Date.now()}`
  try {
    const manifest = await writeTaskHandoff({
      workspaceId,
      planPath: '/tmp/example-plan.md',
      planTitle: 'Example Plan',
      planText: `# Example Plan

## Open Questions / Assumptions
- None.

## Phases
### Phase 1
- Goal: Seed the plan handoff.
- Task breakdown: Write durable files.

### Phase 2
- Goal: Pick up the handoff in another instance.
- Task breakdown: Read the manifest and continue implementation.

## Recommendation
- Start with Phase 1.`,
      codingAgent: 'anthropic/test-model',
      prompt: 'write a handoff plan',
      clarifications: 'Scope: hardening',
    })

    assert.ok(manifest)
    assert.equal(manifest?.seed.taskCount, 2)

    const manifestPath = getWorkspaceTaskManifestPath(workspaceId)
    const taskFilePath = `${getWorkspaceTaskRoot(workspaceId)}/${getTaskSeedFileName()}`
    const manifestFile = JSON.parse(await readFile(manifestPath, 'utf-8'))
    const taskFile = JSON.parse(await readFile(taskFilePath, 'utf-8'))

    assert.equal(manifestFile.plan.path, '/tmp/example-plan.md')
    assert.equal(manifestFile.plan.title, 'Example Plan')
    assert.equal(manifestFile.seed.taskFile, taskFilePath)
    assert.equal(taskFile.tasks.length, 2)
    assert.match(taskFile.tasks[0].subject, /Phase 1: Seed the plan handoff/i)
    assert.equal(taskFile.tasks[0].blocks[0], '2')
    assert.equal(taskFile.tasks[1].blockedBy[0], '1')
    assert.equal(getTaskHandoffFileName(), 'handoff.json')
  } finally {
    await removeWorkspaceTaskRoot(workspaceId)
  }
})
