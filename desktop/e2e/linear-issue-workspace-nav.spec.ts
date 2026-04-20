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

/** Injects project + workspace; returns ids for assertions */
async function seedWorkspaceLinkedToIssue(
  window: Page,
  opts: {
    issueId: string
    identifier: string
    title: string
    /** Match linearIssueAgentBranchName shape */
    branch: string
    /** Omit to test branch-only resolution */
    linearIssueId?: string
    workspaceName: string
  },
): Promise<{ projectId: string; workspaceId: string; otherWorkspaceId: string }> {
  return await window.evaluate((o) => {
    const store = (window as unknown as { __store: { getState: () => any } }).__store.getState()
    store.hydrateState({ projects: [], workspaces: [] })

    const projectId = crypto.randomUUID()
    store.addProject({
      id: projectId,
      name: 'e2e-linear-nav',
      repoPath: '/tmp/constellagent-e2e-linear-nav-placeholder',
    })

    const workspaceId = crypto.randomUUID()
    const otherWorkspaceId = crypto.randomUUID()
    store.addWorkspace({
      id: otherWorkspaceId,
      name: 'other-ws',
      branch: 'main',
      worktreePath: '/tmp/constellagent-e2e-other-wt',
      projectId,
    })
    store.addWorkspace({
      id: workspaceId,
      name: o.workspaceName,
      branch: o.branch,
      worktreePath: '/tmp/constellagent-e2e-linear-wt',
      projectId,
      ...(o.linearIssueId !== undefined ? { linearIssueId: o.linearIssueId } : {}),
    })

    store.updateSettings({
      linearWorkspaceView: 'issues',
      linearIssueScope: 'assigned',
    })
    store.setActiveWorkspace(otherWorkspaceId)
    // Open Linear panel deterministically (toggle would close if persisted state had it open).
    ;(window as unknown as { __store: { setState: (p: unknown) => void } }).__store.setState({
      linearPanelOpen: true,
    })
    return { projectId, workspaceId, otherWorkspaceId }
  }, opts)
}

function dispatchMockIssues(
  window: Page,
  issues: Array<{
    id: string
    identifier: string
    title: string
  }>,
): Promise<void> {
  return window.evaluate((list) => {
    const detail = list.map((row) => ({
      id: row.id,
      identifier: row.identifier,
      title: row.title,
      url: 'https://linear.app/e2e/issue/' + row.id,
      state: { name: 'Backlog', type: 'backlog' },
      team: { id: 'e2e-team', key: 'E2E', name: 'E2E' },
    }))
    window.dispatchEvent(new CustomEvent('constellagent-e2e-linear-issues', { detail }))
  }, issues)
}

test.describe('Linear issue id → workspace', () => {
  test('clicking issue id activates workspace linked by linearIssueId', async () => {
    const { app, window } = await launchApp()
    try {
      const issueId = 'e2e-linear-issue-linked'
      const { workspaceId } = await seedWorkspaceLinkedToIssue(window, {
        issueId,
        identifier: 'E2E-1',
        title: 'Linked navigation',
        branch: 'linear/e2e-1-linked-navigation',
        linearIssueId: issueId,
        workspaceName: 'E2E-1: Linked navigation',
      })

      await expect(window.getByTestId('linear-workspace-panel')).toBeVisible({ timeout: 5000 })
      await dispatchMockIssues(window, [
        { id: issueId, identifier: 'E2E-1', title: 'Linked navigation' },
      ])
      await window.waitForTimeout(300)

      const linkedIssue = window.getByTestId('linear-issue-id-E2E-1')
      await expect(linkedIssue).toHaveAttribute('data-workspace-linked', 'true')
      await linkedIssue.click()
      await window.waitForTimeout(400)

      const active = await window.evaluate(() => {
        return (window as unknown as { __store: { getState: () => { activeWorkspaceId: string | null } } }).__store.getState()
          .activeWorkspaceId
      })
      expect(active).toBe(workspaceId)
      const linearPanelOpen = await window.evaluate(() => {
        return (window as unknown as { __store: { getState: () => { linearPanelOpen: boolean } } }).__store.getState()
          .linearPanelOpen
      })
      expect(linearPanelOpen).toBe(false)
    } finally {
      await app.close()
    }
  })

  test('clicking issue id activates workspace matched by branch pattern', async () => {
    const { app, window } = await launchApp()
    try {
      const { workspaceId } = await seedWorkspaceLinkedToIssue(window, {
        issueId: 'e2e-linear-issue-branch',
        identifier: 'E2E-99',
        title: 'Branch match only',
        branch: 'linear/e2e-99-branch-match-only',
        workspaceName: 'Renamed — no id prefix',
      })

      await expect(window.getByTestId('linear-workspace-panel')).toBeVisible({ timeout: 5000 })
      await dispatchMockIssues(window, [
        { id: 'e2e-linear-issue-branch', identifier: 'E2E-99', title: 'Branch match only' },
      ])
      await window.waitForTimeout(300)

      const linkedIssue = window.getByTestId('linear-issue-id-E2E-99')
      await expect(linkedIssue).toHaveAttribute('data-workspace-linked', 'true')
      await linkedIssue.click()
      await window.waitForTimeout(400)

      const active = await window.evaluate(() => {
        return (window as unknown as { __store: { getState: () => { activeWorkspaceId: string | null } } }).__store.getState()
          .activeWorkspaceId
      })
      expect(active).toBe(workspaceId)
      const linearPanelOpen = await window.evaluate(() => {
        return (window as unknown as { __store: { getState: () => { linearPanelOpen: boolean } } }).__store.getState()
          .linearPanelOpen
      })
      expect(linearPanelOpen).toBe(false)
    } finally {
      await app.close()
    }
  })
})
