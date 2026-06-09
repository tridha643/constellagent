import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { execSync } from 'child_process'

const appPath = resolve(__dirname, '../out/main/index.js')

async function launchApp(): Promise<{ app: ElectronApplication; window: Page }> {
  const { ELECTRON_RENDERER_URL: _ignored, ...env } = process.env
  const app = await electron.launch({ args: [appPath], env: { ...env, CI_TEST: '1' } })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })
  await window.waitForTimeout(1000)
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
    if (existsSync(repoPath)) rmSync(repoPath, { recursive: true, force: true })
  } catch {
    // best effort
  }
}

/** Seed one project + active workspace, then open the Checks & Todos side panel. */
async function seedAndOpen(window: Page, repo: string): Promise<string> {
  return window.evaluate((repoPath: string) => {
    const store = (window as any).__store.getState()
    store.hydrateState({ projects: [], workspaces: [] })
    const projectId = 'proj-checks'
    const wsId = 'ws-checks'
    store.addProject({ id: projectId, name: 'test-repo', repoPath })
    store.addWorkspace({
      id: wsId,
      name: 'ws-1',
      branch: 'feature-branch',
      worktreePath: repoPath,
      projectId,
    })
    store.setActiveWorkspace(wsId)
    store.activatePanel('checks')
    return wsId
  }, repo)
}

test.describe('Checks & Todos side panel', () => {
  test('checks panel is a registered side panel and shows no-PR notice; todos usable', async () => {
    const repo = createTestRepo('checks-open')
    const { app, window } = await launchApp()
    try {
      const wsId = await seedAndOpen(window, repo)

      // The panel is part of the layout's panel order.
      const inOrder = await window.evaluate(() => {
        const s = (window as any).__store.getState()
        return [...s.sidePanels.left.panelOrder, ...s.sidePanels.right.panelOrder].includes('checks')
      })
      expect(inOrder).toBe(true)

      // Panel content renders (mounted only when active).
      await expect(window.getByTestId('checks-todos-panel')).toBeVisible({ timeout: 5000 })

      // Local repo (no GitHub remote) ⇒ inline notice; todos remain usable.
      await expect(
        window.getByText(
          /No pull request for this branch|not a GitHub repository|not authenticated|not installed/i,
        ),
      ).toBeVisible({ timeout: 5000 })
      await expect(window.getByText('Your todos')).toBeVisible()
      await expect(window.getByText('No todos yet')).toBeVisible()

      void wsId
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('todos: add, toggle, edit, reorder, clear-completed, persist across hydrate, delete', async () => {
    const repo = createTestRepo('checks-todos')
    const { app, window } = await launchApp()
    try {
      const wsId = await seedAndOpen(window, repo)
      await expect(window.getByTestId('checks-todos-panel')).toBeVisible({ timeout: 5000 })

      // Add (whitespace-only is a no-op).
      await window.evaluate((id: string) => {
        const store = (window as any).__store.getState()
        store.addTodo(id, 'first')
        store.addTodo(id, 'second')
        store.addTodo(id, '   ')
      }, wsId)

      let todos = await window.evaluate(
        (id: string) => (window as any).__store.getState().workspaceTodos[id],
        wsId,
      )
      expect(todos.map((t: any) => t.text)).toEqual(['first', 'second'])

      // Toggle first done.
      await window.evaluate((id: string) => {
        const store = (window as any).__store.getState()
        store.toggleTodo(id, store.workspaceTodos[id][0].id)
      }, wsId)
      todos = await window.evaluate(
        (id: string) => (window as any).__store.getState().workspaceTodos[id],
        wsId,
      )
      expect(todos[0].done).toBe(true)

      // Inline edit to empty ⇒ revert; then real rename.
      await window.evaluate((id: string) => {
        const store = (window as any).__store.getState()
        const todoId = store.workspaceTodos[id][1].id
        store.renameTodo(id, todoId, '   ')
        store.renameTodo(id, todoId, 'second-renamed')
      }, wsId)
      todos = await window.evaluate(
        (id: string) => (window as any).__store.getState().workspaceTodos[id],
        wsId,
      )
      expect(todos[1].text).toBe('second-renamed')

      // Reorder (swap).
      await window.evaluate((id: string) => {
        const store = (window as any).__store.getState()
        const [a, b] = store.workspaceTodos[id]
        store.reorderTodos(id, [b.id, a.id])
      }, wsId)
      todos = await window.evaluate(
        (id: string) => (window as any).__store.getState().workspaceTodos[id],
        wsId,
      )
      expect(todos.map((t: any) => t.text)).toEqual(['second-renamed', 'first'])

      // Persist across a hydrate round-trip (deserialization path).
      const persisted = await window.evaluate(
        (id: string) => (window as any).__store.getState().workspaceTodos[id],
        wsId,
      )
      await window.evaluate(
        ({ id, todosArg, repoPath }: { id: string; todosArg: any; repoPath: string }) => {
          const store = (window as any).__store.getState()
          store.hydrateState({
            projects: [{ id: 'proj-checks', name: 'test-repo', repoPath }],
            workspaces: [
              { id, name: 'ws-1', branch: 'feature-branch', worktreePath: repoPath, projectId: 'proj-checks' },
            ],
            workspaceTodos: { [id]: todosArg },
          })
          // hydrateState resets the active side panel — reopen it for the UI assertions below.
          const next = (window as any).__store.getState()
          next.setActiveWorkspace(id)
          next.activatePanel('checks')
        },
        { id: wsId, todosArg: persisted, repoPath: repo },
      )
      await expect(window.getByTestId('checks-todos-panel')).toBeVisible({ timeout: 5000 })
      todos = await window.evaluate(
        (id: string) => (window as any).__store.getState().workspaceTodos[id],
        wsId,
      )
      expect(todos.map((t: any) => t.text)).toEqual(['second-renamed', 'first'])

      // Clear completed (the toggled item carried its done flag through hydrate).
      await window.evaluate((id: string) => {
        const store = (window as any).__store.getState()
        const doneIds = store.workspaceTodos[id].filter((t: any) => t.done)
        if (doneIds.length === 0) store.toggleTodo(id, store.workspaceTodos[id][0].id)
        store.clearCompletedTodos(id)
      }, wsId)
      todos = await window.evaluate(
        (id: string) => (window as any).__store.getState().workspaceTodos[id],
        wsId,
      )
      expect(todos.every((t: any) => !t.done)).toBe(true)

      // Delete remaining ⇒ empty state.
      await window.evaluate((id: string) => {
        const store = (window as any).__store.getState()
        for (const t of [...store.workspaceTodos[id]]) store.removeTodo(id, t.id)
      }, wsId)
      todos = await window.evaluate(
        (id: string) => (window as any).__store.getState().workspaceTodos[id] ?? [],
        wsId,
      )
      expect(todos).toEqual([])
      await expect(window.getByText('No todos yet')).toBeVisible()
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })

  test('workspace delete removes its todos', async () => {
    const repo = createTestRepo('checks-cleanup')
    const { app, window } = await launchApp()
    try {
      const wsId = await seedAndOpen(window, repo)
      const removed = await window.evaluate((id: string) => {
        const store = (window as any).__store.getState()
        store.addTodo(id, 'doomed')
        store.removeWorkspace(id)
        return (window as any).__store.getState().workspaceTodos[id]
      }, wsId)
      expect(removed).toBeUndefined()
    } finally {
      await app.close()
      cleanupTestRepo(repo)
    }
  })
})
