import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../out/main/index.js')

async function launchApp(): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({ args: [appPath], env: { ...process.env, CI_TEST: '1' } })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })
  await window.waitForTimeout(1200)
  return { app, window }
}

test.describe('Add Project dialog shortcuts', () => {
  test('Cmd+Option+Left/Right switches Local and Clone tabs', async () => {
    const { app, window } = await launchApp()

    try {
      const addProjectButton = window.getByRole('button', { name: 'Add project' })
      await expect(addProjectButton).toBeVisible({ timeout: 10000 })
      await addProjectButton.click()

      const localTab = window.getByRole('tab', { name: 'Local folder' })
      const cloneTab = window.getByRole('tab', { name: 'Clone from GitHub' })
      await expect(localTab).toBeVisible({ timeout: 5000 })

      await expect(localTab).toHaveAttribute('aria-selected', 'true')
      await expect(cloneTab).toHaveAttribute('aria-selected', 'false')

      await window.keyboard.press('Meta+Alt+ArrowRight')
      await expect(cloneTab).toHaveAttribute('aria-selected', 'true')
      await expect(localTab).toHaveAttribute('aria-selected', 'false')

      await window.keyboard.press('Meta+Alt+ArrowLeft')
      await expect(localTab).toHaveAttribute('aria-selected', 'true')
      await expect(cloneTab).toHaveAttribute('aria-selected', 'false')
    } finally {
      await app.close()
    }
  })
})
