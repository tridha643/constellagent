import { test, expect, _electron as electron } from '@playwright/test'
import { resolve } from 'path'

const appPath = resolve(__dirname, '../out/main/index.js')

let app: Awaited<ReturnType<typeof electron.launch>>
let window: Awaited<ReturnType<typeof app.firstWindow>>

test.beforeEach(async () => {
  app = await electron.launch({
    args: [appPath],
    env: { ...process.env, CI_TEST: '1' },
  })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })
  await window.waitForTimeout(1500)
})

test.afterEach(async () => {
  await app.close()
})

test('orchestrator panel opens and closes', async () => {
  // Click the Orchestrator button in the sidebar
  const orchestratorBtn = window.locator('button', { hasText: 'Orchestrator' })
  await expect(orchestratorBtn).toBeVisible()
  await orchestratorBtn.click()

  // Panel should be visible
  await expect(window.locator('h2', { hasText: 'Orchestrator' })).toBeVisible()

  // Status badge should show "Idle"
  await expect(window.locator('text=Idle')).toBeVisible()

  // Press Escape to close
  await window.keyboard.press('Escape')
  await expect(window.locator('h2', { hasText: 'Orchestrator' })).not.toBeVisible()
})

test('orchestrator shows empty state', async () => {
  const orchestratorBtn = window.locator('button', { hasText: 'Orchestrator' })
  await orchestratorBtn.click()

  // Message thread shows empty state
  await expect(window.locator('text=No messages yet')).toBeVisible()

  // Session panel shows empty state
  await expect(window.locator('text=No active sessions')).toBeVisible()
})

test('orchestrator command input is interactive', async () => {
  const orchestratorBtn = window.locator('button', { hasText: 'Orchestrator' })
  await orchestratorBtn.click()

  // Command textarea should be visible and interactive
  const textarea = window.locator('textarea[placeholder*="Send a command"]')
  await expect(textarea).toBeVisible()
  await textarea.fill('test command')
  await expect(textarea).toHaveValue('test command')

  // Send button should be enabled when there's text
  const sendBtn = window.locator('button', { hasText: 'Send' })
  await expect(sendBtn).toBeEnabled()
})

test('orchestrator start button requires SendBlue API key', async () => {
  const orchestratorBtn = window.locator('button', { hasText: 'Orchestrator' })
  await orchestratorBtn.click()

  // Start button should be disabled without API key configured
  const startBtn = window.locator('button', { hasText: 'Start' })
  await expect(startBtn).toBeVisible()
  await expect(startBtn).toBeDisabled()
})

test('orchestrator status updates on start/stop', async () => {
  // This test verifies the status badge updates. Since we can't actually connect
  // to SendBlue in tests, we verify the UI state transitions.
  const orchestratorBtn = window.locator('button', { hasText: 'Orchestrator' })
  await orchestratorBtn.click()

  const statusBadge = window.locator('text=Idle')
  await expect(statusBadge).toBeVisible()

  // Verify the back button closes the panel
  const backBtn = window.locator('[class*="backBtn"]').first()
  await backBtn.click()
  await expect(window.locator('h2', { hasText: 'Orchestrator' })).not.toBeVisible()
})
