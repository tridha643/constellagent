import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../out/main/index.js')

async function launchApp(): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({ args: [appPath], env: { ...process.env, CI_TEST: '1' } })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })
  await window.waitForTimeout(1500)
  return { app, window }
}

test.describe('Linear workspace pill', () => {
  test('shows four tabs and tab order setting updates DOM order', async () => {
    const { app, window } = await launchApp()
    try {
      await window.evaluate(() => {
        const store = (
          window as unknown as {
            __store: { getState: () => { toggleLinear: () => void; updateSettings: (p: unknown) => void } }
          }
        ).__store.getState()
        store.toggleLinear()
      })
      await expect(window.getByTestId('linear-workspace-panel')).toBeVisible({ timeout: 5000 })

      const pill = window.getByTestId('linear-workspace-view-pill')
      await expect(pill.getByRole('tab')).toHaveCount(4)

      await window.evaluate(() => {
        const store = (
          window as unknown as {
            __store: {
              getState: () => { updateSettings: (p: unknown) => void }
            }
          }
        ).__store.getState()
        store.updateSettings({
          linearWorkspaceTabOrder: ['updates', 'tickets', 'projects', 'issues'],
        })
      })

      const orderFromStore = await window.evaluate(() => {
        return (
          window as unknown as {
            __store: {
              getState: () => { settings: { linearWorkspaceTabOrder: string[] } }
            }
          }
        ).__store.getState().settings.linearWorkspaceTabOrder
      })
      expect(orderFromStore).toEqual(['updates', 'tickets', 'projects', 'issues'])
    } finally {
      await app.close()
    }
  })
})
