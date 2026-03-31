import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { execSync } from 'child_process'

const appPath = resolve(__dirname, '../out/main/index.js')

async function launchApp(label: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [appPath],
    env: {
      ...process.env,
      CI_TEST: '1',
      CONSTELLAGENT_NOTIFY_DIR: join('/tmp', `constellagent-notify-${label}-${Date.now()}`),
      CONSTELLAGENT_ACTIVITY_DIR: join('/tmp', `constellagent-activity-${label}-${Date.now()}`),
    },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })
  await window.waitForTimeout(1500)
  return { app, window }
}

function createTestRepo(name: string): string {
  const repoPath = join('/tmp', `automations-repo-${name}-${Date.now()}`)
  mkdirSync(repoPath, { recursive: true })
  execSync('git init', { cwd: repoPath })
  execSync('git checkout -b main', { cwd: repoPath })
  writeFileSync(join(repoPath, 'README.md'), '# Automations Test Repo\n')
  execSync('git add .', { cwd: repoPath })
  execSync('git commit -m "initial commit"', { cwd: repoPath })
  return repoPath
}

function cleanupRepo(repoPath: string): void {
  rmSync(repoPath, { recursive: true, force: true })
}

test.describe('Automations verification loop', () => {
  test('workspace-created event triggers shell-command automation', async () => {
    const repoPath = createTestRepo('workspace-created')
    const outputPath = join(repoPath, 'automation-workspace-created.txt')
    const { app, window } = await launchApp('workspace-created')

    try {
      await window.evaluate(async ({ repoPath, outputPath }) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [], automations: [] })

        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'automations-repo', repoPath })

        const automation = {
          id: crypto.randomUUID(),
          name: 'workspace-create-shell',
          projectId,
          prompt: '',
          cronExpression: '',
          enabled: true,
          createdAt: Date.now(),
          trigger: { type: 'event', eventType: 'workspace:created' },
          action: { type: 'run-shell-command', command: `printf 'created' > "${outputPath}"` },
          cooldownMs: 30000,
        }

        store.addAutomation(automation)
        await (window as any).api.automations.create({
          id: automation.id,
          name: automation.name,
          projectId,
          trigger: automation.trigger,
          action: automation.action,
          enabled: true,
          repoPath,
          cooldownMs: automation.cooldownMs,
        })

        store.addWorkspace({
          id: crypto.randomUUID(),
          name: 'automation-target',
          branch: 'main',
          worktreePath: repoPath,
          projectId,
        })
      }, { repoPath, outputPath })

      await expect.poll(() => existsSync(outputPath), { timeout: 5000 }).toBe(true)
    } finally {
      await app.close()
      cleanupRepo(repoPath)
    }
  })

  test('manual write-to-pty automation can drive a live workspace terminal', async () => {
    const repoPath = createTestRepo('write-to-pty')
    const outputPath = join(repoPath, 'automation-write-to-pty.txt')
    const { app, window } = await launchApp('write-to-pty')

    try {
      await window.evaluate(async ({ repoPath, outputPath }) => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [], automations: [] })

        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'automations-repo', repoPath })

        const workspaceId = crypto.randomUUID()
        store.addWorkspace({
          id: workspaceId,
          name: 'pty-target',
          branch: 'main',
          worktreePath: repoPath,
          projectId,
        })

        const ptyId = await (window as any).api.pty.create(repoPath, '/bin/bash', { AGENT_ORCH_WS_ID: workspaceId })
        store.addTab({
          id: crypto.randomUUID(),
          workspaceId,
          type: 'terminal',
          title: 'Terminal',
          ptyId,
        })

        const automation = {
          id: crypto.randomUUID(),
          name: 'manual-write-to-pty',
          projectId,
          prompt: '',
          cronExpression: '',
          enabled: true,
          createdAt: Date.now(),
          trigger: { type: 'manual' },
          action: { type: 'write-to-pty', workspaceId, input: `printf 'pty-automation' > "${outputPath}"\n` },
          cooldownMs: 30000,
        }

        store.addAutomation(automation)
        await (window as any).api.automations.create({
          id: automation.id,
          name: automation.name,
          projectId,
          trigger: automation.trigger,
          action: automation.action,
          enabled: true,
          repoPath,
          cooldownMs: automation.cooldownMs,
        })
        await (window as any).api.automations.runNow({
          id: automation.id,
          name: automation.name,
          projectId,
          trigger: automation.trigger,
          action: automation.action,
          enabled: true,
          repoPath,
          cooldownMs: automation.cooldownMs,
        })
      }, { repoPath, outputPath })

      await expect.poll(() => existsSync(outputPath), { timeout: 5000 }).toBe(true)
    } finally {
      await app.close()
      cleanupRepo(repoPath)
    }
  })
})

