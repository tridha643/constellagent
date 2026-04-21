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

test.describe('Linear resolver and tickets', () => {
  test('workspace pill searches across projects and graphite stack branches', async () => {
    const { app, window } = await launchApp()

    try {
      const ids = await window.evaluate(() => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })

        const projectId = crypto.randomUUID()
        const mainWorkspaceId = crypto.randomUUID()
        const stackWorkspaceId = crypto.randomUUID()

        store.addProject({
          id: projectId,
          name: 'workspace-search-project',
          repoPath: '/tmp/constellagent-linear-workspace-search',
        })
        store.addWorkspace({
          id: mainWorkspaceId,
          name: 'Workspace main',
          branch: 'main',
          worktreePath: '/tmp/constellagent-linear-main',
          projectId,
        })
        store.addWorkspace({
          id: stackWorkspaceId,
          name: 'Workspace feature',
          branch: 'feature-ui',
          worktreePath: '/tmp/constellagent-linear-feature',
          projectId,
        })
        store.setGraphiteStack(stackWorkspaceId, {
          currentBranch: 'feature-ui',
          branches: [
            { name: 'main', parent: null },
            { name: 'feature-api', parent: 'main' },
            { name: 'feature-ui', parent: 'feature-api' },
          ],
        })
        store.setActiveWorkspace(mainWorkspaceId)
        store.updateSettings({ linearWorkspaceView: 'tickets' })
        ;(window as any).__store.setState({ linearPanelOpen: true })

        return { mainWorkspaceId, stackWorkspaceId }
      })

      await expect(window.getByTestId('linear-workspace-panel')).toBeVisible({ timeout: 5000 })

      await expect(window.getByTestId('linear-workspace-picker-trigger')).toContainText('main')
      await window.getByTestId('linear-workspace-picker-trigger').click()
      await window.getByTestId('linear-workspace-picker-input').fill('workspace-search-project')
      await window.getByRole('option', { name: /workspace-search-project.*project/i }).click()

      await expect(window.getByTestId('linear-workspace-picker-trigger')).toContainText('main')

      let activeWorkspaceId = await window.evaluate(() => {
        return (window as any).__store.getState().activeWorkspaceId
      })
      expect(activeWorkspaceId).toBe(ids.mainWorkspaceId)

      await window.getByTestId('linear-workspace-picker-trigger').click()
      await window.getByTestId('linear-workspace-picker-input').fill('feature-api')
      await window.getByRole('option', { name: /feature-api.*workspace feature/i }).click()

      await expect(window.getByTestId('linear-workspace-picker-trigger')).toContainText('feature-ui · stack')
      activeWorkspaceId = await window.evaluate(() => {
        return (window as any).__store.getState().activeWorkspaceId
      })
      expect(activeWorkspaceId).toBe(ids.stackWorkspaceId)
    } finally {
      await app.close()
    }
  })

  test('ticket creation copies the created issue link only when the setting is enabled', async () => {
    const { app, window } = await launchApp()

    try {
      await window.evaluate(() => {
        const store = (window as any).__store.getState()
        store.hydrateState({ projects: [], workspaces: [] })

        const projectId = crypto.randomUUID()
        const workspaceId = crypto.randomUUID()
        store.addProject({
          id: projectId,
          name: 'ticket-project',
          repoPath: '/tmp/constellagent-linear-ticket-project',
        })
        store.addWorkspace({
          id: workspaceId,
          name: 'ticket-workspace',
          branch: 'ticket-branch',
          worktreePath: '/tmp/constellagent-linear-ticket-worktree',
          projectId,
        })
        store.setActiveWorkspace(workspaceId)
        store.updateSettings({
          linearWorkspaceView: 'tickets',
          linearCopyCreatedIssueToClipboard: true,
        })
        ;(window as any).__store.setState({ linearPanelOpen: true })
      })

      await expect(window.getByTestId('linear-workspace-panel')).toBeVisible({ timeout: 5000 })

      await window.evaluate(() => {
        window.dispatchEvent(
          new CustomEvent('constellagent-e2e-linear-bootstrap', {
            detail: {
              teams: [{ id: 'team-eng', key: 'ENG', name: 'Engineering' }],
              issueCreateResponse: {
                id: 'issue-enabled',
                identifier: 'E2E-101',
                title: 'Copied issue',
                url: 'https://linear.app/e2e/issue/enabled',
                state: { name: 'Backlog', type: 'backlog' },
                team: { id: 'team-eng', key: 'ENG', name: 'Engineering' },
              },
            },
          }),
        )
      })

      await window.getByRole('button', { name: /Choose team/i }).click()
      await window.getByRole('option', { name: 'ENG · Engineering' }).click()
      await window.getByTestId('linear-tickets-title').fill('Copy me')
      await window.getByTestId('linear-tickets-send').click()

      await expect(window.getByText('Created E2E-101 and copied link')).toBeVisible({
        timeout: 5000,
      })
      const copiedUrl = await app.evaluate(({ clipboard }) => clipboard.readText())
      expect(copiedUrl).toBe('https://linear.app/e2e/issue/enabled')

      await window.evaluate(() => {
        const store = (window as any).__store.getState()
        store.updateSettings({ linearCopyCreatedIssueToClipboard: false })
        window.dispatchEvent(
          new CustomEvent('constellagent-e2e-linear-bootstrap', {
            detail: {
              issueCreateResponse: {
                id: 'issue-disabled',
                identifier: 'E2E-102',
                title: 'Not copied issue',
                url: 'https://linear.app/e2e/issue/disabled',
                state: { name: 'Backlog', type: 'backlog' },
                team: { id: 'team-eng', key: 'ENG', name: 'Engineering' },
              },
            },
          }),
        )
      })

      await window.getByTestId('linear-tickets-title').fill('Do not copy me')
      await window.getByTestId('linear-tickets-send').click()

      await expect(window.getByText('Created E2E-102')).toBeVisible({ timeout: 5000 })
      const copiedAfterDisabled = await app.evaluate(({ clipboard }) => clipboard.readText())
      expect(copiedAfterDisabled).toBe('https://linear.app/e2e/issue/enabled')
    } finally {
      await app.close()
    }
  })
})
