import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { resolve, join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync, rmSync } from 'fs'

const appPath = resolve(__dirname, '../out/main/index.js')

function createUserDataPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), `constellagent-${name}-`)), 'user-data')
}

async function launchApp(userDataPath: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [appPath],
    env: {
      ...process.env,
      CI_TEST: '1',
      CONSTELLAGENT_USER_DATA_PATH: userDataPath,
      CONSTELLAGENT_BROWSER_EXECUTABLE: join(userDataPath, 'missing-browser.exe'),
    },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })
  await window.waitForTimeout(1000)
  return { app, window }
}

test.describe('browser context panel', () => {
  test('handles missing browser executable and stores browser state', async () => {
    const userDataPath = createUserDataPath('browser-context')
    const { app, window } = await launchApp(userDataPath)
    const consoleErrors: string[] = []
    window.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    try {
      await window.getByTestId('right-panel-mode-browser').click()
      await expect(window.getByText('Open the in-app Chromium browser to inspect the current page.')).toBeVisible()
      await window.getByRole('button', { name: /Open Browser/ }).click()
      await expect(window.getByText(/Chromium executable not found:/)).toBeVisible()
      await expect(window.getByRole('button', { name: /Inspect/ })).toBeDisabled()
      await expect(window.getByRole('button', { name: /Edit/ })).toBeDisabled()
      expect(consoleErrors.join('\n')).not.toContain("Error occurred in handler for 'browser-context:connect'")

      const sidePanels = await window.evaluate(() => (window as any).__store.getState().sidePanels)
      expect(sidePanels.right.activePanel).toBe('browser')
      expect(sidePanels.right.panelOrder).toContain('browser')
    } finally {
      await app.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
