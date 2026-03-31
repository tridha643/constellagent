import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AutomationEngine } from '../src/main/automation-engine'
import { emitAutomationEvent } from '../src/main/automation-event-bus'
import type { AutomationConfigV2 } from '../src/shared/automation-types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return
    await Bun.sleep(25)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function main(): Promise<void> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'constellagent-automations-smoke-'))
  const shellOutputPath = join(workspaceRoot, 'workspace-created.txt')
  const cooldownOutputPath = join(workspaceRoot, 'cooldown.txt')
  const notifications: Array<{ title: string; body: string }> = []
  const ptyWrites: Array<{ ptyId: string; input: string }> = []

  const fakePtyManager = {
    getPtyIdsForWorkspace(workspaceId: string) {
      return workspaceId === 'ws-pty' ? ['pty-1'] : []
    },
    write(ptyId: string, input: string) {
      ptyWrites.push({ ptyId, input })
    },
  } as any

  const engine = new AutomationEngine(fakePtyManager, {
    getWindows: () => [],
    execShellCommand: async (command, cwd) => {
      if (command.startsWith('write-file ')) {
        const [, filePath, contents] = command.split(' ')
        await writeFile(join(cwd, filePath), contents, 'utf8')
        return
      }
      if (command.startsWith('append-file ')) {
        const [, filePath, contents] = command.split(' ')
        const target = join(cwd, filePath)
        const existing = existsSync(target) ? await readFile(target, 'utf8') : ''
        await writeFile(target, existing + contents, 'utf8')
        return
      }
      throw new Error(`Unsupported smoke command: ${command}`)
    },
    showNotification: (title, body) => {
      notifications.push({ title, body })
    },
  })

  try {
    const eventAutomation: AutomationConfigV2 = {
      id: 'event-shell',
      name: 'event-shell',
      projectId: 'project-1',
      trigger: { type: 'event', eventType: 'workspace:created' },
      action: { type: 'run-shell-command', command: 'write-file workspace-created.txt fired' },
      enabled: true,
      repoPath: workspaceRoot,
      cooldownMs: 30_000,
    }
    engine.upsert(eventAutomation)

    emitAutomationEvent({
      type: 'workspace:created',
      timestamp: Date.now(),
      projectId: 'project-1',
      workspaceId: 'ws-1',
      branch: 'main',
    })

    await waitFor(() => existsSync(shellOutputPath), 2000, 'event shell output')
    assert((await readFile(shellOutputPath, 'utf8')) === 'fired', 'workspace-created automation did not write expected output')

    const cooldownAutomation: AutomationConfigV2 = {
      id: 'cooldown-shell',
      name: 'cooldown-shell',
      projectId: 'project-1',
      trigger: { type: 'event', eventType: 'workspace:created' },
      action: { type: 'run-shell-command', command: 'append-file cooldown.txt hit\\n' },
      enabled: true,
      repoPath: workspaceRoot,
      cooldownMs: 30_000,
    }
    engine.upsert(cooldownAutomation)

    emitAutomationEvent({
      type: 'workspace:created',
      timestamp: Date.now(),
      projectId: 'project-1',
      workspaceId: 'ws-2',
      branch: 'main',
    })
    emitAutomationEvent({
      type: 'workspace:created',
      timestamp: Date.now(),
      projectId: 'project-1',
      workspaceId: 'ws-3',
      branch: 'main',
    })

    await waitFor(() => existsSync(cooldownOutputPath), 2000, 'cooldown output')
    assert((await readFile(cooldownOutputPath, 'utf8')) === 'hit\\n', 'cooldown automation fired more than once')

    const notificationAutomation: AutomationConfigV2 = {
      id: 'notify',
      name: 'notify',
      projectId: 'project-1',
      trigger: { type: 'manual' },
      action: { type: 'send-notification', title: 'Checks failed', body: 'feature/test' },
      enabled: true,
      repoPath: workspaceRoot,
      cooldownMs: 30_000,
    }
    await engine.runNow(notificationAutomation as any)
    await Bun.sleep(25)
    assert(notifications.length === 1, 'manual notification automation did not emit')

    const ptyAutomation: AutomationConfigV2 = {
      id: 'pty',
      name: 'pty',
      projectId: 'project-1',
      trigger: { type: 'manual' },
      action: { type: 'write-to-pty', workspaceId: 'ws-pty', input: 'echo smoke\\n' },
      enabled: true,
      repoPath: workspaceRoot,
      cooldownMs: 30_000,
    }
    await engine.runNow(ptyAutomation as any)
    await Bun.sleep(25)
    assert(ptyWrites.length === 1, 'manual write-to-pty automation did not write to PTY')
    assert(ptyWrites[0]?.ptyId === 'pty-1', 'write-to-pty targeted the wrong PTY')
    assert(ptyWrites[0]?.input === 'echo smoke\\n', 'write-to-pty sent the wrong input')

    console.log('[automations-smoke] passed')
  } finally {
    engine.destroyAll()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}

await main()

