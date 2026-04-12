import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { execSync } from 'child_process'

const appPath = resolve(__dirname, '../out/main/index.js')

type LaunchOptions = {
  settingsPath: string
  userDataPath: string
}

async function launchApp({ settingsPath, userDataPath }: LaunchOptions): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [appPath],
    env: {
      ...process.env,
      CI_TEST: '1',
      CONSTELLAGENT_PROJECT_SETTINGS_PATH: settingsPath,
      CONSTELLAGENT_USER_DATA_PATH: userDataPath,
    },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })
  await window.waitForTimeout(1500)
  return { app, window }
}

function createTestRepo(name: string): string {
  const repoPath = join('/tmp', `test-repo-${name}-${Date.now()}`)
  mkdirSync(repoPath, { recursive: true })
  execSync('git init', { cwd: repoPath })
  execSync('git checkout -b main', { cwd: repoPath })
  writeFileSync(join(repoPath, 'README.md'), '# Test Repo\n')
  execSync('git add .', { cwd: repoPath })
  execSync('git commit -m "initial commit"', { cwd: repoPath })
  return repoPath
}

function cleanupTestRepo(repoPath: string): void {
  try {
    if (existsSync(repoPath)) {
      rmSync(repoPath, { recursive: true, force: true })
    }
    const parentDir = resolve(repoPath, '..')
    const repoName = repoPath.split('/').pop()
    if (repoName && existsSync(parentDir)) {
      for (const entry of require('fs').readdirSync(parentDir)) {
        if (entry.startsWith(`${repoName}-ws-`)) {
          rmSync(join(parentDir, entry), { recursive: true, force: true })
        }
      }
    }
  } catch {
    // best effort
  }
}

function makeTempPaths(name: string): { settingsPath: string; userDataPath: string } {
  const base = mkdtempSync(join(tmpdir(), `constellagent-${name}-`))
  return {
    settingsPath: join(base, '.constellagent-project-settings.json'),
    userDataPath: join(base, 'user-data'),
  }
}

function seedPersistedState(userDataPath: string, data: unknown): void {
  mkdirSync(userDataPath, { recursive: true })
  writeFileSync(join(userDataPath, 'constellagent-state.json'), JSON.stringify(data, null, 2), 'utf-8')
}

function seedExternalSettings(settingsPath: string, repoPath: string, startupCommands: Array<{ name: string; command: string }>): void {
  mkdirSync(resolve(settingsPath, '..'), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify({
    version: 1,
    projects: {
      [repoPath]: { startupCommands, updatedAt: Date.now() },
    },
  }, null, 2), 'utf-8')
}

async function addProject(window: Page, repoPath: string, name = 'startup-project'): Promise<string> {
  return await window.evaluate(async ({ repo, projectName }: { repo: string; projectName: string }) => {
    const store = (window as any).__store.getState()
    store.hydrateState({ projects: [], workspaces: [] })
    const id = crypto.randomUUID()
    store.addProject({ id, name: projectName, repoPath: repo })
    return id
  }, { repo: repoPath, projectName: name })
}

test.describe('external project startup settings', () => {
  test('round-trips startup settings via IPC into the hidden JSON file', async () => {
    const repoPath = createTestRepo('startup-ipc')
    const paths = makeTempPaths('startup-ipc')
    const { app, window } = await launchApp(paths)

    try {
      const commands = [{ name: 'Dev', command: 'echo from-ipc' }]
      const loaded = await window.evaluate(async ({ repo, startupCommands }: { repo: string; startupCommands: Array<{ name: string; command: string }> }) => {
        await (window as any).api.projectStartupSettings.set(repo, startupCommands)
        return await (window as any).api.projectStartupSettings.get(repo)
      }, { repo: repoPath, startupCommands: commands })

      expect(loaded).toEqual(commands)
      expect(existsSync(paths.settingsPath)).toBe(true)

      const file = JSON.parse(readFileSync(paths.settingsPath, 'utf-8')) as {
        version: number
        projects: Record<string, { startupCommands: Array<{ name: string; command: string }> }>
      }
      expect(file.version).toBe(1)
      expect(Object.values(file.projects)).toHaveLength(1)
      expect(Object.values(file.projects)[0]?.startupCommands).toEqual(commands)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
      rmSync(resolve(paths.settingsPath, '..'), { recursive: true, force: true })
    }
  })

  test('saving from Project Settings persists to the external file', async () => {
    const repoPath = createTestRepo('startup-ui')
    const paths = makeTempPaths('startup-ui')
    const { app, window } = await launchApp(paths)

    try {
      await addProject(window, repoPath, 'ui-project')
      await window.waitForTimeout(1200)

      const projectHeader = window.locator('[class*="projectHeader"]', { hasText: 'ui-project' })
      await expect(projectHeader).toBeVisible()
      await projectHeader.hover()
      await window.locator('[aria-label="Project settings"]').first().click({ force: true })
      await window.getByRole('button', { name: /Startup commands/i }).click()
      await expect(window.locator('code', { hasText: paths.settingsPath })).toBeVisible()
      await window.getByRole('button', { name: /Add command/i }).click()
      await window.getByPlaceholder('Tab name').fill('Dev server')
      await window.getByPlaceholder('command').fill('echo ui-settings')
      await window.getByRole('button', { name: 'Save' }).click()
      await window.waitForTimeout(1200)

      const file = JSON.parse(readFileSync(paths.settingsPath, 'utf-8')) as {
        projects: Record<string, { startupCommands: Array<{ name: string; command: string }> }>
      }
      expect(Object.values(file.projects)[0]?.startupCommands).toEqual([
        { name: 'Dev server', command: 'echo ui-settings' },
      ])

    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
      rmSync(resolve(paths.settingsPath, '..'), { recursive: true, force: true })
    }
  })

  test('fresh launch loads external startup settings into Project Settings', async () => {
    const repoPath = createTestRepo('startup-fresh-launch')
    const paths = makeTempPaths('startup-fresh-launch')
    seedPersistedState(paths.userDataPath, {
      projects: [{ id: 'fresh-project', name: 'fresh-project', repoPath }],
      workspaces: [],
    })
    seedExternalSettings(paths.settingsPath, repoPath, [{ name: 'Fresh dev', command: 'echo fresh' }])

    const { app, window } = await launchApp(paths)

    try {
      const projectHeader = window.locator('[class*="projectHeader"]', { hasText: 'fresh-project' })
      await expect(projectHeader).toBeVisible()
      await projectHeader.hover()
      await window.locator('[aria-label="Project settings"]').first().click({ force: true })
      await expect(window.locator('code', { hasText: paths.settingsPath })).toBeVisible()
      await expect(window.locator('input[value="Fresh dev"]')).toBeVisible()
      await expect(window.locator('input[value="echo fresh"]')).toBeVisible()
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
      rmSync(resolve(paths.settingsPath, '..'), { recursive: true, force: true })
    }
  })

  test('migrates legacy persisted project startup commands into the external file on hydration', async () => {
    const repoPath = createTestRepo('startup-migrate')
    const paths = makeTempPaths('startup-migrate')
    seedPersistedState(paths.userDataPath, {
      projects: [
        {
          id: 'legacy-project',
          name: 'legacy-project',
          repoPath,
          startupCommands: [{ name: 'Legacy dev', command: 'echo legacy' }],
        },
      ],
      workspaces: [],
    })

    const { app, window } = await launchApp(paths)

    try {
      const migrated = await window.evaluate(async (repo: string) => {
        return await (window as any).api.projectStartupSettings.get(repo)
      }, repoPath)

      expect(migrated).toEqual([{ name: 'Legacy dev', command: 'echo legacy' }])
      expect(existsSync(paths.settingsPath)).toBe(true)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
      rmSync(resolve(paths.settingsPath, '..'), { recursive: true, force: true })
    }
  })

  test('external startup settings override legacy state and drive workspace startup tabs', async () => {
    const repoPath = createTestRepo('startup-workspace')
    const paths = makeTempPaths('startup-workspace')
    seedPersistedState(paths.userDataPath, {
      projects: [
        {
          id: 'external-project',
          name: 'external-project',
          repoPath,
          startupCommands: [{ name: 'Legacy only', command: 'echo legacy-only' }],
        },
      ],
      workspaces: [],
    })
    seedExternalSettings(paths.settingsPath, repoPath, [
      { name: 'External one', command: 'echo external-one' },
      { name: 'External two', command: 'echo external-two' },
    ])

    const { app, window } = await launchApp(paths)

    try {
      const startupCommands = await window.evaluate(() => {
        return (window as any).__store.getState().projects[0]?.startupCommands ?? null
      })
      expect(startupCommands).toEqual([
        { name: 'External one', command: 'echo external-one' },
        { name: 'External two', command: 'echo external-two' },
      ])

      const projectId = await window.evaluate(() => {
        return (window as any).__store.getState().projects[0]?.id ?? null
      })
      expect(projectId).toBeTruthy()

      await window.evaluate((id: string) => {
        ;(window as any).__store.getState().openWorkspaceDialog(id)
      }, projectId as string)
      await expect(window.getByText('New Workspace', { exact: true })).toBeVisible()
      await window.getByPlaceholder('workspace-name').fill('external-startup-ws')
      await window.waitForTimeout(1200)
      await window.getByRole('button', { name: 'Create' }).click()
      await window.waitForTimeout(3000)

      await expect(window.locator('[class*="tabTitle"]', { hasText: 'External one' })).toBeVisible()
      await expect(window.locator('[class*="tabTitle"]', { hasText: 'External two' })).toBeVisible()
      await expect(window.locator('[class*="tabTitle"]', { hasText: 'Legacy only' })).toHaveCount(0)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
      rmSync(resolve(paths.settingsPath, '..'), { recursive: true, force: true })
    }
  })
})
