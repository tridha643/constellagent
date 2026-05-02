import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { resolve, join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync, rmSync } from 'fs'

const appPath = resolve(__dirname, '../out/main/index.js')

function createUserDataPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), `constellagent-${name}-`)), 'user-data')
}

async function launchApp(userDataPath?: string): Promise<{ app: ElectronApplication; window: Page }> {
  const env = { ...process.env, CI_TEST: '1' } as Record<string, string>
  if (userDataPath) env.CONSTELLAGENT_USER_DATA_PATH = userDataPath

  const app = await electron.launch({ args: [appPath], env })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })
  await window.waitForTimeout(1500)
  return { app, window }
}

test.describe('app shell', () => {
  test('launches with a valid symmetric 3-pane shell', async () => {
    const userDataPath = createUserDataPath('app-shell-layout')
    const { app, window } = await launchApp(userDataPath)

    try {
      await expect(window.getByTestId('side-panel-left')).toBeVisible()
      await expect(window.getByTestId('right-panel')).toBeVisible()
      await expect(window.locator('[class*="welcomeLogo"]')).toContainText('constellagent')

      const sidePanels = await window.evaluate(() => (window as any).__store.getState().sidePanels)
      expect(sidePanels.left).toEqual({
        open: true,
        activePanel: 'project',
        panelOrder: ['project'],
      })
      expect(sidePanels.right).toEqual({
        open: true,
        activePanel: 'files',
        panelOrder: ['files', 'changes', 'graph', 'browser'],
      })

      await expect(window.getByTestId('side-panel-tab-project')).toBeVisible()
      await expect(window.getByTestId('right-panel-mode-files')).toBeVisible()
      await expect(window.getByTestId('right-panel-mode-changes')).toBeVisible()
      await expect(window.getByTestId('right-panel-mode-graph')).toBeVisible()
      await expect(window.getByTestId('right-panel-mode-browser')).toBeVisible()
    } finally {
      await app.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  test('swapping sidebar roles from Settings persists after restart', async () => {
    const userDataPath = createUserDataPath('app-shell-swap-persist')
    let app: ElectronApplication | null = null
    let window: Page | null = null

    try {
      ;({ app, window } = await launchApp(userDataPath))

      await window.keyboard.press('Meta+,')
      await expect(window.getByText('Sidebar Layout')).toBeVisible({ timeout: 5000 })
      await window.getByRole('button', { name: 'Swap' }).click()
      await window.keyboard.press('Meta+,')
      await expect(window.getByTestId('side-panel-left')).toBeVisible({ timeout: 5000 })

      let sidePanels = await window.evaluate(() => (window as any).__store.getState().sidePanels)
      expect(sidePanels.left.panelOrder).toEqual(['files', 'changes', 'graph', 'browser'])
      expect(sidePanels.right.panelOrder).toEqual(['project'])

      await app.close()

      ;({ app, window } = await launchApp(userDataPath))
      sidePanels = await window.evaluate(() => (window as any).__store.getState().sidePanels)
      expect(sidePanels.left.panelOrder).toEqual(['files', 'changes', 'graph', 'browser'])
      expect(sidePanels.right.panelOrder).toEqual(['project'])

      const persisted = await window.evaluate(async () => {
        return await (window as any).api.state.load()
      })
      expect(persisted.sidePanels.left.panelOrder).toEqual(['files', 'changes', 'graph', 'browser'])
      expect(persisted.sidePanels.right.panelOrder).toEqual(['project'])
    } finally {
      if (app) await app.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
