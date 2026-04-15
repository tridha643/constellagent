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

test.describe('Settings restart control', () => {
  test('shows a restart action in Settings', async () => {
    const { app, window } = await launchApp()

    try {
      await window.keyboard.press('Meta+,')
      const restartRow = window.locator('[class*="row"]').filter({
        has: window.locator('[class*="rowLabel"]', { hasText: 'Restart app' }),
      }).first()

      await expect(window.getByRole('heading', { name: 'Settings' })).toBeVisible()
      await expect(restartRow.getByRole('button', { name: 'Restart' })).toBeVisible()
      await expect(restartRow.locator('[class*="rowDescription"]')).toContainText('Fully quit and reopen Constellagent so main-process and preload changes reload after pulls or rebuilds.')
    } finally {
      await app.close()
    }
  })
})
