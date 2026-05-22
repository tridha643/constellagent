import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../out/main/index.js')

async function launchApp(): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [appPath],
    env: { ...process.env, CI_TEST: '1' },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })
  await window.waitForTimeout(1000)
  return { app, window }
}

test.describe('Conductor AskQuestion UI', () => {
  let app: ElectronApplication
  let window: Page

  test.beforeAll(async () => {
    ;({ app, window } = await launchApp())
  })

  test.afterAll(async () => {
    await app.close()
  })

  test('exposes respondBlockingQuestion on agentChat API', async () => {
    const hasRespond = await window.evaluate(() => {
      return typeof (window as unknown as { api: { agentChat: { respondBlockingQuestion?: unknown } } }).api
        .agentChat.respondBlockingQuestion === 'function'
    })
    expect(hasRespond).toBe(true)
  })
})
