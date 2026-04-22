import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, realpathSync, symlinkSync } from 'fs'
import { execSync } from 'child_process'

const appPath = resolve(__dirname, '../out/main/index.js')
const HAS_TYPESCRIPT_LSP = hasCommand('typescript-language-server')

function hasCommand(command: string): boolean {
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore', shell: '/bin/bash' })
    return true
  } catch {
    return false
  }
}

async function launchApp(): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({ args: [appPath], env: { ...process.env, CI_TEST: '1' } })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })
  await window.waitForTimeout(1500)
  return { app, window }
}

function createTestRepo(name: string): string {
  const repoPath = join('/tmp', `test-repo-${name}-${Date.now()}`)
  mkdirSync(repoPath, { recursive: true })
  execSync('git init', { cwd: repoPath })
  execSync('git checkout -b main', { cwd: repoPath })
  writeFileSync(join(repoPath, 'README.md'), '# Test Repo\n')
  mkdirSync(join(repoPath, 'src'), { recursive: true })
  writeFileSync(join(repoPath, 'src/index.ts'), 'console.log("hello world")\n')
  writeFileSync(join(repoPath, 'src/utils.ts'), 'export function add(a: number, b: number) { return a + b }\n')
  execSync('git add .', { cwd: repoPath })
  execSync('git commit -m "initial commit"', { cwd: repoPath })
  return repoPath
}

function commitAll(repoPath: string, message: string, date: string): void {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  }
  execSync('git add .', { cwd: repoPath, env })
  execSync(`git commit -m "${message}"`, { cwd: repoPath, env })
}

function createRepoWithLargeNonHeadCommit(name: string): string {
  const repoPath = createTestRepo(name)

  writeFileSync(join(repoPath, 'src/index.ts'), 'console.log("head commit")\n')
  commitAll(repoPath, 'head-selected-commit', '2026-01-02T00:00:00Z')

  execSync('git checkout -b large-history HEAD~1', { cwd: repoPath })
  const hugeContent = Array.from({ length: 4000 }, (_unused, i) => `line ${i}`).join('\n') + '\n'
  writeFileSync(join(repoPath, 'Pi-rewind.txt'), hugeContent)
  commitAll(repoPath, 'Pi-rewind', '2030-01-03T00:00:00Z')

  execSync('git checkout main', { cwd: repoPath })
  return repoPath
}

function createRepoWithLargeContextFile(name: string): string {
  const repoPath = createTestRepo(name)
  const largeContent = Array.from({ length: 40 }, (_unused, i) => `line ${i + 1}`).join('\n') + '\n'
  writeFileSync(join(repoPath, 'src/index.ts'), largeContent)
  writeFileSync(join(repoPath, 'src/utils.ts'), largeContent)
  execSync('git add src/index.ts', { cwd: repoPath })
  execSync('git add src/utils.ts', { cwd: repoPath })
  execSync('git commit -m "add large context file"', { cwd: repoPath })
  return repoPath
}

function createRepoWithHiddenConfigChanges(name: string): string {
  const repoPath = createTestRepo(name)
  mkdirSync(join(repoPath, '.codex', 'skills', 'hunk-review-comments'), { recursive: true })
  mkdirSync(join(repoPath, '.cursor', 'rules'), { recursive: true })
  mkdirSync(join(repoPath, '.cursor', 'skills'), { recursive: true })
  mkdirSync(join(repoPath, '.gemini', 'skills'), { recursive: true })
  mkdirSync(join(repoPath, 'desktop', '.claude', 'skills'), { recursive: true })

  writeFileSync(join(repoPath, '.codex', 'AGENTS.md'), '# Codex agent\n')
  writeFileSync(join(repoPath, '.codex', 'skills', 'hunk-review-comments', 'SKILL.md'), '# Hunk review\n')
  writeFileSync(join(repoPath, '.cursor', 'rules', 'constellagent.mdc'), 'rule: keep it fast\n')
  writeFileSync(join(repoPath, '.gemini', 'AGENTS.md'), '# Gemini agent\n')
  symlinkSync('../../desktop/.claude/skills', join(repoPath, '.cursor', 'skills', 'hunk-review'))
  symlinkSync('../../desktop/.claude/skills', join(repoPath, '.gemini', 'skills', 'hunk-review'))

  return repoPath
}

function cleanupTestRepo(repoPath: string): void {
  try {
    if (existsSync(repoPath)) {
      rmSync(repoPath, { recursive: true, force: true })
    }
    const parentDir = resolve(repoPath, '..')
    const repoName = repoPath.split('/').pop()
    if (repoName) {
      const entries = readdirSync(parentDir)
      for (const entry of entries) {
        if (entry.startsWith(`${repoName}-ws-`)) {
          rmSync(join(parentDir, entry), { recursive: true, force: true })
        }
      }
    }
  } catch {
    // best effort
  }
}

/** Set up project + workspace in the app store, return worktree path */
async function setupWorkspace(window: Page, repoPath: string, suffix: string): Promise<string> {
  return await window.evaluate(async ({ repo, sfx }: { repo: string; sfx: string }) => {
    const store = (window as any).__store.getState()
    store.hydrateState({ projects: [], workspaces: [] })
    const projectId = crypto.randomUUID()
    store.addProject({ id: projectId, name: 'test-repo', repoPath: repo })

    const worktreePath = await (window as any).api.git.createWorktree(repo, `ws-${sfx}`, `branch-${sfx}`, true)
    const wsId = crypto.randomUUID()
    store.addWorkspace({
      id: wsId, name: `ws-${sfx}`, branch: `branch-${sfx}`, worktreePath, projectId,
    })
    return worktreePath
  }, { repo: repoPath, sfx: suffix })
}

async function setupWorkspaceWithTerminal(
  window: Page,
  repoPath: string,
  suffix: string,
): Promise<{ ptyId: string; worktreePath: string }> {
  const worktreePath = await setupWorkspace(window, repoPath, suffix)
  return await window.evaluate(async ({ wt }: { wt: string }) => {
    const store = (window as any).__store.getState()
    const workspace = store.workspaces.find((entry: any) => entry.id === store.activeWorkspaceId)
    if (!workspace) throw new Error('Missing active workspace')
    const ptyId = await (window as any).api.pty.create(wt)
    store.addTab({
      id: crypto.randomUUID(),
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Terminal 1',
      ptyId,
    })
    return { ptyId, worktreePath: wt }
  }, { wt: worktreePath })
}

async function dropFilePathIntoTerminal(window: Page, absolutePath: string): Promise<void> {
  const terminal = window.locator('[class*="terminalContainer"]').first()
  await expect(terminal).toBeVisible({ timeout: 5000 })

  const dataTransfer = await window.evaluateHandle((path: string) => {
    const dt = new DataTransfer()
    dt.setData('application/x-constellagent-path', path)
    dt.setData('text/plain', path)
    return dt
  }, absolutePath)

  await terminal.dispatchEvent('dragenter', { dataTransfer })
  await terminal.dispatchEvent('dragover', { dataTransfer })
  await terminal.dispatchEvent('drop', { dataTransfer })
}

async function openFileTab(window: Page, filePath: string): Promise<void> {
  await window.evaluate((path: string) => {
    const store = (window as any).__store.getState()
    const workspaceId = store.activeWorkspaceId
    if (!workspaceId) throw new Error('no active workspace')
    store.addTab({
      id: crypto.randomUUID(),
      workspaceId,
      type: 'file',
      filePath: path,
    })
  }, filePath)
}

async function getFileDiffSlices(
  window: Page,
  worktreePath: string,
  filePath: string,
): Promise<{ staged: string; unstaged: string }> {
  return await window.evaluate(async ({ wt, path }: { wt: string; path: string }) => {
    const [staged, unstaged] = await Promise.all([
      (window as any).api.git.getDiff(wt, true),
      (window as any).api.git.getDiff(wt, false),
    ])
    const select = (rows: Array<{ path: string; hunks: string }>) =>
      rows.find((row) => row.path === path)?.hunks ?? ''
    return {
      staged: select(staged),
      unstaged: select(unstaged),
    }
  }, { wt: worktreePath, path: filePath })
}

test.describe('File tree & editor integration', () => {
  test('file tree loads and shows files when workspace is active', async () => {
    const repoPath = createTestRepo('ftree-1')
    const { app, window } = await launchApp()

    try {
      await setupWorkspace(window, repoPath, 'ftree')
      await window.waitForTimeout(1000)

      // Right panel should show file tree by default
      const filesBtn = window.locator('button', { hasText: 'Files' })
      const filesBtnClass = await filesBtn.getAttribute('class')
      expect(filesBtnClass).toContain('active')

      // Wait for tree to load
      await window.waitForTimeout(1000)

      // Should see src directory and README.md
      const readmeItem = window.locator('[data-item-path="README.md"][data-item-type="file"]')
      await expect(readmeItem).toBeVisible()

      const srcItem = window.locator('[data-item-path="src/"][data-item-type="folder"]')
      await expect(srcItem).toBeVisible()

      await window.screenshot({
        path: resolve(__dirname, 'screenshots/file-tree-loaded.png'),
      })
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('clicking file in tree opens editor tab with content', async () => {
    const repoPath = createTestRepo('editor-1')
    const { app, window } = await launchApp()

    try {
      await setupWorkspace(window, repoPath, 'editor')
      await window.waitForTimeout(1000)

      // Wait for file tree to load
      await window.waitForTimeout(2000)

      // Open a non-markdown file — .md opens in preview by default, not the Monaco editor.
      // Folders start collapsed (openByDefault=false); expand `src` before leaf `index.ts` is visible.
      const srcFolder = window.locator('[data-item-path="src/"][data-item-type="folder"]').first()
      await expect(srcFolder).toBeVisible({ timeout: 5000 })
      await srcFolder.click()
      await window.waitForTimeout(400)
      const fileItem = window.locator('[data-item-path="src/index.ts"][data-item-type="file"]').first()
      await expect(fileItem).toBeVisible({ timeout: 5000 })
      await fileItem.click()
      await window.waitForTimeout(3000)

      // A new tab should appear with index.ts
      const tab = window.locator('[class*="tab"]', { hasText: 'index.ts' }).first()
      await expect(tab).toBeVisible({ timeout: 5000 })
      await expect(tab.locator('[data-file-icon-token="typescript"]')).toBeVisible({ timeout: 5000 })

      // Monaco editor should be rendered
      const monacoEditor = window.locator('.monaco-editor').first()
      await expect(monacoEditor).toBeVisible({ timeout: 10000 })
      await expect.poll(async () => window.evaluate(() => {
        const store = (window as any).__store.getState()
        return store.activeMonacoEditor?.getModel()?.getLanguageId() ?? null
      })).toBe('typescript')
      await expect.poll(async () => window.evaluate(() => {
        const store = (window as any).__store.getState()
        return store.activeMonacoEditor?.getModel()?.uri.path ?? ''
      })).toContain('/src/index.ts')

      await window.screenshot({
        path: resolve(__dirname, 'screenshots/editor-file-opened.png'),
      })
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('clicking markdown file opens markdown preview with a shared file icon tab', async () => {
    const repoPath = createTestRepo('markdown-preview-1')
    const { app, window } = await launchApp()

    try {
      await setupWorkspace(window, repoPath, 'markdown-preview')
      await window.waitForTimeout(1500)

      const readmeItem = window.locator('[data-item-path="README.md"][data-item-type="file"]').first()
      await expect(readmeItem).toBeVisible({ timeout: 5000 })
      await readmeItem.click()

      await expect(window.locator('[class*="tabTitle"]', { hasText: 'README.md' })).toBeVisible({ timeout: 5000 })
      await expect(window.locator('[data-file-icon-token="markdown"]').first()).toBeVisible({ timeout: 5000 })
      await expect.poll(async () => window.evaluate(() => {
        const store = (window as any).__store.getState()
        return store.tabs.find((tab: any) => tab.id === store.activeTabId)?.type ?? null
      })).toBe('markdownPreview')
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('cmd-clicking a tree file opens it in a split pane', async () => {
    const repoPath = createTestRepo('split-open-1')
    const { app, window } = await launchApp()

    try {
      await setupWorkspace(window, repoPath, 'split-open')
      await window.waitForTimeout(1500)

      const srcFolder = window.locator('[data-item-path="src/"][data-item-type="folder"]').first()
      await expect(srcFolder).toBeVisible({ timeout: 5000 })
      await srcFolder.click()
      await window.waitForTimeout(400)

      const fileItem = window.locator('[data-item-path="src/index.ts"][data-item-type="file"]').first()
      await expect(fileItem).toBeVisible({ timeout: 5000 })
      await window.evaluate(() => {
        const host = document.querySelector('[data-testid="file-tree"]') as HTMLElement | null
        const target = host?.shadowRoot?.querySelector('[data-item-path="src/index.ts"][data-item-type="file"]') as HTMLElement | null
        if (!target) throw new Error('tree file not found')
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, metaKey: true }))
      })

      await expect.poll(async () => window.evaluate(() => {
        const store = (window as any).__store.getState()
        const tab = store.tabs.find((entry: any) => entry.id === store.activeTabId)
        const stringify = (node: any): string[] => {
          if (!node) return []
          if (node.type === 'leaf') return node.contentType === 'file' ? [node.filePath] : []
          return node.children.flatMap((child: any) => stringify(child))
        }
        const splitFiles = stringify(tab?.splitRoot)
        return Boolean(tab?.splitRoot && splitFiles.some((path) => path.endsWith('/src/index.ts')))
      })).toBe(true)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('terminal drag-in accepts a file path payload and writes the bracketed paste text', async () => {
    const repoPath = createTestRepo('tree-terminal-drag-1')
    const { app, window } = await launchApp()

    try {
      const { worktreePath } = await setupWorkspaceWithTerminal(window, repoPath, 'tree-terminal-drag')
      await window.waitForTimeout(2000)

      await dropFilePathIntoTerminal(window, `${worktreePath}/src/index.ts`)

      await expect(window.locator('[class*="terminalContainer"]').first()).toContainText('src/index.ts', {
        timeout: 5000,
      })
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('editing file and saving with Cmd+S writes to disk', async () => {
    const repoPath = createTestRepo('save-1')
    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'save')
      await window.waitForTimeout(1000)

      // Open a source file — README.md defaults to preview mode, so Cmd+S would not hit Monaco.
      // Build path from active workspace (reconcile may append extra worktrees; [0] is not always active).
      await window.evaluate(() => {
        const store = (window as any).__store.getState()
        const ws = store.workspaces.find((w: any) => w.id === store.activeWorkspaceId)
        if (!ws) throw new Error('no active workspace')
        const base = ws.worktreePath.replace(/\/$/, '')
        store.addTab({
          id: crypto.randomUUID(),
          workspaceId: ws.id,
          type: 'file',
          filePath: `${base}/src/index.ts`,
        })
      })

      await window.waitForTimeout(2000)

      await expect(window.locator('[class*="tabTitle"]', { hasText: 'index.ts' })).toBeVisible({
        timeout: 10000,
      })

      // Type new content into Monaco
      const monacoEditor = window.locator('.monaco-editor').first()
      await expect(monacoEditor).toBeVisible({ timeout: 15000 })
      await monacoEditor.click()

      // Select all and type new content
      await window.keyboard.press('Meta+a')
      await window.keyboard.type('# Updated Content\n')
      await window.waitForTimeout(500)

      // Save with Cmd+S
      await window.keyboard.press('Meta+s')
      await window.waitForTimeout(1000)

      // Verify file on disk was updated (resolve symlinks for macOS)
      const realWt = realpathSync(worktreePath)
      const content = readFileSync(join(realWt, 'src/index.ts'), 'utf-8')
      expect(content).toContain('Updated Content')

      await window.screenshot({
        path: resolve(__dirname, 'screenshots/editor-file-saved.png'),
      })
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('workspace TypeScript files do not show Monaco false-positive import errors', async () => {
    const repoPath = createTestRepo('editor-valid-imports')
    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'editor-valid-imports')
      const realWt = realpathSync(worktreePath)
      writeFileSync(
        join(realWt, 'src/index.ts'),
        'import { add } from "./utils"\n\nconsole.log(add(1, 2))\n',
      )

      await window.evaluate(() => {
        const store = (window as any).__store.getState()
        store.updateSettings({ editorMonacoSemanticDiagnostics: true })
      })

      await openFileTab(window, `${worktreePath}/src/index.ts`)
      const monacoEditor = window.locator('.monaco-editor').first()
      await expect(monacoEditor).toBeVisible({ timeout: 10000 })
      await monacoEditor.click()

      await expect.poll(async () => window.evaluate(() => {
        const store = (window as any).__store.getState()
        const model = store.activeMonacoEditor?.getModel()
        if (!model) return null
        return model.getAllDecorations().some((decoration: any) => {
          const options = decoration.options ?? {}
          return JSON.stringify(options).includes('squiggly-error')
        })
      }), { timeout: 5000 }).toBe(false)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('language override persists per file and reopens with the remembered mode', async () => {
    const repoPath = createTestRepo('editor-language-override')
    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'editor-language')
      const testFilePath = `${worktreePath}/notes.txt`
      writeFileSync(join(realpathSync(worktreePath), 'notes.txt'), 'const greeting = "hello"\n')

      await openFileTab(window, testFilePath)
      await expect(window.locator('.monaco-editor').first()).toBeVisible({ timeout: 10000 })

      const languageSelect = window.locator('[data-testid="editor-language-select"]').first()
      await expect(languageSelect).toBeVisible()
      await languageSelect.selectOption('typescript')
      await window.locator('.monaco-editor').first().click()

      await expect.poll(async () => window.evaluate((payload: { filePath: string; worktreePath: string }) => {
        const store = (window as any).__store.getState()
        const key = `${payload.worktreePath}::${payload.filePath}`
        return store.settings.editorLanguageOverrides[key] ?? ''
      }, { filePath: testFilePath, worktreePath })).toBe('typescript')
      await expect.poll(async () => window.evaluate(() => {
        const store = (window as any).__store.getState()
        return store.activeMonacoEditor?.getModel()?.getLanguageId() ?? null
      })).toBe('typescript')
      await expect.poll(async () => window.evaluate(() => {
        const store = (window as any).__store.getState()
        return store.activeMonacoEditor?.getModel()?.uri.path ?? ''
      })).toContain('.__constellagent__.ts')

      await window.evaluate((path: string) => {
        const store = (window as any).__store.getState()
        const fileTab = store.tabs.find((tab: any) => tab.type === 'file' && tab.filePath === path)
        if (!fileTab) throw new Error('file tab not found')
        store.removeTab(fileTab.id)
      }, testFilePath)
      await window.waitForTimeout(300)

      await openFileTab(window, testFilePath)
      await expect(window.locator('.monaco-editor').first()).toBeVisible({ timeout: 10000 })
      await window.locator('.monaco-editor').first().click()
      await expect(window.locator('[data-testid="editor-language-select"]').first()).toHaveValue('typescript')
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('non-TS file opened in TypeScript mode binds the virtual TS document for language service work', async () => {
    test.skip(!HAS_TYPESCRIPT_LSP, 'requires typescript-language-server')

    const repoPath = createTestRepo('editor-lsp-diagnostics')
    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'editor-lsp')
      const testFilePath = `${worktreePath}/lsp-check.txt`
      writeFileSync(join(realpathSync(worktreePath), 'lsp-check.txt'), 'const total: string = 123\n')

      await openFileTab(window, testFilePath)
      await expect(window.locator('.monaco-editor').first()).toBeVisible({ timeout: 10000 })
      await expect
        .poll(async () => window.evaluate(() => Boolean((window as any).__monaco)))
        .toBe(true)
      await window.locator('[data-testid="editor-language-select"]').first().selectOption('typescript')
      await window.locator('.monaco-editor').first().click()

      await expect.poll(async () => window.evaluate(() => {
        return (window as any).__store.getState().activeMonacoEditor?.getModel()?.getLanguageId() ?? null
      }), { timeout: 10000 }).toBe('typescript')

      await expect.poll(async () => window.evaluate(() => {
        return (window as any).__store.getState().activeMonacoEditor?.getModel()?.uri.path ?? ''
      })).toContain('.__constellagent__.ts')
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })
})

test.describe('Changed files & diff viewer', () => {
  test('changes panel shows modified files', async () => {
    const repoPath = createTestRepo('changes-1')
    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'changes')
      await window.waitForTimeout(1000)

      // Modify a file in the worktree (resolve symlinks for macOS /tmp -> /private/tmp)
      const realWtPath = realpathSync(worktreePath)
      writeFileSync(join(realWtPath, 'README.md'), '# Modified Content\nNew line\n')

      // Switch to Changes panel
      const changesBtn = window.locator('button', { hasText: 'Changes' })
      await changesBtn.click()
      await window.waitForTimeout(2000)

      // Should show README.md as modified — use statusBadge parent to avoid matching the list container
      const changedFile = window.locator('[class*="statusBadge"]', { hasText: 'M' }).locator('..')
      await expect(changedFile).toBeVisible({ timeout: 5000 })
      await expect(changedFile).toContainText('README.md')

      await window.screenshot({
        path: resolve(__dirname, 'screenshots/changes-panel-modified.png'),
      })
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('clicking changed file opens diff viewer', async () => {
    const repoPath = createTestRepo('diff-view-1')
    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'diff')
      await window.waitForTimeout(1000)

      // Modify a file (resolve symlinks for macOS /tmp -> /private/tmp)
      const realWtPath = realpathSync(worktreePath)
      writeFileSync(join(realWtPath, 'README.md'), '# Completely Different\nNew content here\n')

      // Switch to Changes panel
      const changesBtn = window.locator('button', { hasText: 'Changes' })
      await changesBtn.click()
      await window.waitForTimeout(1500)

      // Click the changed file to open diff
      const changedFile = window.locator('[class*="statusBadge"]', { hasText: 'M' }).locator('..')
      await changedFile.click()
      await window.waitForTimeout(2000)

      // Diff tab should appear
      const diffTab = window.locator('[class*="tabTitle"]', { hasText: 'Changes' })
      await expect(diffTab).toBeVisible()

      // Diff toolbar should be visible
      const diffToolbar = window.locator('[class*="diffToolbar"]')
      await expect(diffToolbar).toBeVisible()

      // Side-by-side and Inline toggle buttons should exist
      const sideBtn = window.locator('[class*="diffToggleOption"]', { hasText: 'Side by side' })
      const inlineBtn = window.locator('[class*="diffToggleOption"]', { hasText: 'Inline' })
      await expect(sideBtn).toBeVisible()
      await expect(inlineBtn).toBeVisible()

      await window.screenshot({
        path: resolve(__dirname, 'screenshots/diff-viewer-opened.png'),
      })
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('diff viewer keeps the first chunk expanded and collapses the remainder for large change sets', async () => {
    const repoPath = createTestRepo('diff-many-files')
    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'diff-many')
      await window.waitForTimeout(1000)

      const realWtPath = realpathSync(worktreePath)
      mkdirSync(join(realWtPath, 'src/many'), { recursive: true })
      for (let i = 0; i < 45; i += 1) {
        writeFileSync(
          join(realWtPath, `src/many/file-${String(i).padStart(2, '0')}.ts`),
          `export const value${i} = ${i}\n`,
        )
      }

      const changesBtn = window.locator('button', { hasText: 'Changes' })
      await changesBtn.click()
      await window.waitForTimeout(1500)

      const changedFile = window.locator('[class*="statusBadge"]', { hasText: 'U' })
        .locator('..', { hasText: 'file-00.ts' })
      await changedFile.click()

      const diffToolbar = window.locator('[class*="diffToolbar"]')
      await expect(diffToolbar).toBeVisible({ timeout: 10000 })
      await expect(diffToolbar).toContainText('First files expanded, remaining files collapsed for performance')
      await expect(window.locator('[id="diff-src/many/file-00.ts"]')).toBeVisible({ timeout: 10000 })
      await expect(window.locator('[id="diff-src/many/file-44.ts"]')).toHaveCount(1)
      const file00Section = window.locator('[id="diff-src/many/file-00.ts"]')
      const file00Toggle = file00Section.locator('[data-testid="diff-collapse-toggle"]')
      await expect(file00Toggle).toHaveText('Collapse')
      await expect(file00Section).toContainText('export const value0 = 0')

      const file14Section = window.locator('[id="diff-src/many/file-14.ts"]')
      await expect(file14Section.locator('[data-testid="diff-collapse-toggle"]')).toHaveText('Collapse')
      await expect(file14Section).toContainText('export const value14 = 14')

      const file15Section = window.locator('[id="diff-src/many/file-15.ts"]')
      const file15Toggle = file15Section.locator('[data-testid="diff-collapse-toggle"]')
      await expect(file15Toggle).toHaveText('Expand')
      await expect(file15Section).not.toContainText('export const value15 = 15')
      await file15Toggle.click()
      await expect(file15Toggle).toHaveText('Collapse')
      await expect(file15Section).toContainText('export const value15 = 15')

      await window.locator('[class*="fileStripItem"]', { hasText: 'file-44.ts' }).click()
      await expect(window.locator('[id="diff-src/many/file-44.ts"]')).toBeVisible({ timeout: 10000 })

      await openFileTab(window, join(worktreePath, 'README.md'))
      const readmeTab = window.locator('[class*="tabTitle"]', { hasText: 'README.md' })
      await expect(readmeTab).toBeVisible({ timeout: 5000 })

      const diffTab = window.locator('[class*="tabTitle"]', { hasText: 'Changes' })
      await diffTab.click()
      await expect(diffToolbar).toBeVisible({ timeout: 1500 })
      await expect(window.locator('[id="diff-src/many/file-00.ts"]')).toBeVisible({ timeout: 1500 })
      await expect(window.locator('[id="diff-src/many/file-00.ts"]').locator('[data-testid="diff-collapse-toggle"]')).toHaveText('Collapse')
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('diff viewer renders hidden config and symlink changes instead of blank placeholders', async () => {
    const repoPath = createRepoWithHiddenConfigChanges('diff-hidden-config')
    const { app, window } = await launchApp()

    try {
      await setupWorkspace(window, repoPath, 'diff-hidden')
      await window.waitForTimeout(1000)

      const changesBtn = window.locator('button', { hasText: 'Changes' })
      await changesBtn.click()
      await window.waitForTimeout(1500)

      const changedFile = window.locator('[class*="statusBadge"]', { hasText: 'U' })
        .locator('..', { hasText: '.codex/AGENTS.md' })
      await changedFile.click()

      const codexSection = window.locator('[id="diff-.codex/AGENTS.md"]')
      await expect(codexSection).toBeVisible({ timeout: 10000 })
      await expect(codexSection).toContainText('Codex agent')

      const symlinkSection = window.locator('[id="diff-.cursor/skills/hunk-review"]')
      await expect(symlinkSection).toBeVisible({ timeout: 10000 })
      await expect(symlinkSection).not.toContainText('No diff available')
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('diff viewer keeps full-context toggles file-scoped and preserves gap expanders', async () => {
    const repoPath = createRepoWithLargeContextFile('diff-expand-1')
    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'diff-expand')
      await window.waitForTimeout(1000)

      const realWtPath = realpathSync(worktreePath)
      const updatedIndexContent = Array.from({ length: 40 }, (_unused, i) =>
        i === 19 ? 'line 20 changed' : `line ${i + 1}`,
      ).join('\n') + '\n'
      const updatedUtilsContent = Array.from({ length: 40 }, (_unused, i) =>
        i === 24 ? 'line 25 changed' : `line ${i + 1}`,
      ).join('\n') + '\n'
      writeFileSync(join(realWtPath, 'src/index.ts'), updatedIndexContent)
      writeFileSync(join(realWtPath, 'src/utils.ts'), updatedUtilsContent)

      const changesBtn = window.locator('button', { hasText: 'Changes' })
      await changesBtn.click()
      await window.waitForTimeout(1500)

      const changedFile = window.locator('[class*="statusBadge"]', { hasText: 'M' }).locator('..', { hasText: 'index.ts' })
      await changedFile.click()
      await window.waitForTimeout(2000)

      const indexSection = window.locator('[id="diff-src/index.ts"]')
      const utilsSection = window.locator('[id="diff-src/utils.ts"]')
      await expect(indexSection).toBeVisible()
      await expect(utilsSection).toBeVisible()

      const indexSeparators = indexSection.locator('[data-unmodified-lines]')
      const utilsSeparators = utilsSection.locator('[data-unmodified-lines]')
      expect(await indexSeparators.count()).toBeGreaterThan(0)
      expect(await utilsSeparators.count()).toBeGreaterThan(0)

      const showFullFileToggle = indexSection.locator('[data-testid="show-full-file-toggle"]')
      await expect(showFullFileToggle).toBeVisible()
      await showFullFileToggle.click({ force: true })
      await expect.poll(async () => indexSeparators.count()).toBe(0)
      expect(await utilsSeparators.count()).toBeGreaterThan(0)

      const utilsExpandButtons = utilsSection.locator('[data-expand-button]')
      const initialUtilsSeparatorCount = await utilsSeparators.count()
      await expect(utilsExpandButtons.first()).toBeVisible()
      await utilsExpandButtons.first().click({ force: true })
      await expect.poll(async () => utilsSeparators.count()).not.toBe(initialUtilsSeparatorCount)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('diff viewer honors full-context default from settings', async () => {
    const repoPath = createRepoWithLargeContextFile('diff-expand-default')
    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'diff-expand-default')
      await window.evaluate(() => {
        const store = (window as any).__store.getState()
        store.updateSettings({ diffShowFullContextByDefault: true })
      })
      await window.waitForTimeout(200)

      const realWtPath = realpathSync(worktreePath)
      const updatedContent = Array.from({ length: 40 }, (_unused, i) =>
        i === 19 ? 'line 20 changed' : `line ${i + 1}`,
      ).join('\n') + '\n'
      writeFileSync(join(realWtPath, 'src/index.ts'), updatedContent)

      const changesBtn = window.locator('button', { hasText: 'Changes' })
      await changesBtn.click()
      await window.waitForTimeout(1500)

      const changedFile = window.locator('[class*="statusBadge"]', { hasText: 'M' }).locator('..', { hasText: 'index.ts' })
      await changedFile.click()
      await window.waitForTimeout(2000)

      const indexSection = window.locator('[id="diff-src/index.ts"]')
      const showFullFileToggle = indexSection.locator('[data-testid="show-full-file-toggle"]')
      await expect(showFullFileToggle).toHaveText('Changed only')
      await expect.poll(async () => indexSection.locator('[data-unmodified-lines]').count()).toBe(0)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('git panel highlights HEAD without auto-opening the first --all commit diff', async () => {
    const repoPath = createRepoWithLargeNonHeadCommit('git-graph-head')
    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'git-graph')
      await window.waitForTimeout(1000)

      const logInfo = await window.evaluate(async (wt: string) => {
        const [log, headHash] = await Promise.all([
          (window as any).api.git.getLog(wt),
          (window as any).api.git.getHeadHash(wt),
        ])
        return {
          headHash,
          headMessage: log.find((entry: any) => entry.hash === headHash)?.message ?? '',
          firstHash: log[0]?.hash ?? '',
          firstMessage: log[0]?.message ?? '',
        }
      }, worktreePath)

      expect(logInfo.firstHash).not.toBe(logInfo.headHash)
      expect(logInfo.firstMessage).toBe('Pi-rewind')
      expect(logInfo.headMessage).toBe('head-selected-commit')

      const gitBtn = window.locator('button', { hasText: 'Git' })
      await gitBtn.click()
      await window.waitForTimeout(1500)

      expect(await window.locator('[class*="tabTitle"]').count()).toBe(0)

      const headRow = window.locator('[class*="commitRow"]', { hasText: logInfo.headMessage }).first()
      await expect(headRow).toBeVisible({ timeout: 5000 })
      await expect(headRow).toHaveClass(/selected/)

      const firstRow = window.locator('[class*="commitRow"]', { hasText: logInfo.firstMessage }).first()
      await expect(firstRow).toBeVisible({ timeout: 5000 })
      await expect(firstRow).not.toHaveClass(/selected/)

      await firstRow.click()
      await expect(window.locator('[class*="diffToolbar"]')).toBeVisible({ timeout: 10000 })
      await expect(window.locator('[class*="diffFileCount"]')).toContainText('Pi-rewind')
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('changes hunk Keep and Undo apply only the selected hunk and survive lazy diff hydration', async () => {
    const repoPath = createTestRepo('diff-hunk-actions')
    const targetRelativePath = 'src/zzz-target.ts'
    const targetOriginal = Array.from({ length: 20 }, (_unused, i) =>
      `export const target${i + 1} = ${i + 1}`,
    ).join('\n') + '\n'
    writeFileSync(join(repoPath, targetRelativePath), targetOriginal)
    execSync('git add src/zzz-target.ts', { cwd: repoPath })
    execSync('git commit -m "add hunk target"', { cwd: repoPath })

    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'diff-hunk-actions')
      await window.waitForTimeout(1000)

      const realWtPath = realpathSync(worktreePath)
      writeFileSync(join(realWtPath, 'README.md'), '# Test Repo\nupdated readme\n')
      writeFileSync(join(realWtPath, 'src/index.ts'), 'console.log("hello hunk test")\n')
      writeFileSync(join(realWtPath, 'src/utils.ts'), 'export function add(a: number, b: number) { return a + b + 1 }\n')
      const targetLines = targetOriginal.trimEnd().split('\n')
      targetLines[1] = 'export const target2 = 200'
      targetLines[15] = 'export const target16 = 1600'
      writeFileSync(join(realWtPath, targetRelativePath), targetLines.join('\n') + '\n')

      const changesBtn = window.locator('button', { hasText: 'Changes' })
      await changesBtn.click()
      await window.waitForTimeout(1200)

      const targetChange = window.locator('[class*="changePath"]', { hasText: 'zzz-target.ts' })
      await expect(targetChange).toBeVisible({ timeout: 5000 })
      await targetChange.click()

      const diffToolbar = window.locator('[class*="diffToolbar"]')
      await expect(diffToolbar).toBeVisible({ timeout: 10000 })

      const targetSection = window.locator('[id="diff-src/zzz-target.ts"]')
      await expect(targetSection).toBeVisible({ timeout: 10000 })
      const collapseToggle = targetSection.locator('[data-testid="diff-collapse-toggle"]')
      if (await collapseToggle.textContent() === 'Expand') {
        await collapseToggle.click()
      }
      await expect(targetSection).toContainText('export const target2 = 200')
      await expect(targetSection.getByRole('button', { name: 'Keep hunk' }).first()).toBeVisible({ timeout: 10000 })

      await targetSection.getByRole('button', { name: 'Keep hunk' }).first().click()

      await expect.poll(async () => {
        const diffs = await getFileDiffSlices(window, worktreePath, targetRelativePath)
        return {
          stagedHasFirst: diffs.staged.includes('export const target2 = 200'),
          stagedHasSecond: diffs.staged.includes('export const target16 = 1600'),
          unstagedHasFirst: diffs.unstaged.includes('export const target2 = 200'),
          unstagedHasSecond: diffs.unstaged.includes('export const target16 = 1600'),
        }
      }).toEqual({
        stagedHasFirst: true,
        stagedHasSecond: false,
        unstagedHasFirst: false,
        unstagedHasSecond: true,
      })

      await expect.poll(async () =>
        targetSection.getByRole('button', { name: 'Keep hunk' }).count(),
      ).toBe(1)

      await expect.poll(async () =>
        targetSection.getByRole('button', { name: 'Undo hunk' }).count(),
      ).toBe(1)

      await targetSection.getByRole('button', { name: 'Undo hunk' }).last().click()

      await expect.poll(async () => {
        const diffs = await getFileDiffSlices(window, worktreePath, targetRelativePath)
        return {
          stagedHasFirst: diffs.staged.includes('export const target2 = 200'),
          stagedHasSecond: diffs.staged.includes('export const target16 = 1600'),
          unstagedHasFirst: diffs.unstaged.includes('export const target2 = 200'),
          unstagedHasSecond: diffs.unstaged.includes('export const target16 = 1600'),
        }
      }).toEqual({
        stagedHasFirst: true,
        stagedHasSecond: false,
        unstagedHasFirst: false,
        unstagedHasSecond: false,
      })

      await expect.poll(async () =>
        await window.evaluate(async (wt: string) =>
          await (window as any).api.fs.readFile(`${wt}/src/zzz-target.ts`),
        worktreePath),
      ).toContain('export const target16 = 16')
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('changes hunk actions stay hidden for files with both staged and unstaged changes', async () => {
    const repoPath = createTestRepo('diff-mixed-stage')
    const targetRelativePath = 'src/mixed-stage.ts'
    const targetOriginal = Array.from({ length: 20 }, (_unused, i) =>
      `export const mixed${i + 1} = ${i + 1}`,
    ).join('\n') + '\n'
    writeFileSync(join(repoPath, targetRelativePath), targetOriginal)
    execSync('git add src/mixed-stage.ts', { cwd: repoPath })
    execSync('git commit -m "add mixed stage target"', { cwd: repoPath })

    const { app, window } = await launchApp()

    try {
      const worktreePath = await setupWorkspace(window, repoPath, 'diff-mixed-stage')
      await window.waitForTimeout(1000)

      const realWtPath = realpathSync(worktreePath)
      const targetPath = join(realWtPath, targetRelativePath)
      let targetLines = targetOriginal.trimEnd().split('\n')
      targetLines[1] = 'export const mixed2 = 200'
      writeFileSync(targetPath, targetLines.join('\n') + '\n')
      execSync('git add src/mixed-stage.ts', { cwd: realWtPath })
      targetLines = targetLines.slice()
      targetLines[15] = 'export const mixed16 = 1600'
      writeFileSync(targetPath, targetLines.join('\n') + '\n')

      const changesBtn = window.locator('button', { hasText: 'Changes' })
      await changesBtn.click()
      await window.waitForTimeout(1200)

      const targetChange = window.locator('[class*="changePath"]', { hasText: 'mixed-stage.ts' }).first()
      await expect(targetChange).toBeVisible({ timeout: 5000 })
      await targetChange.click()

      const targetSection = window.locator('[id="diff-src/mixed-stage.ts"]').first()
      await expect(targetSection).toBeVisible({ timeout: 10000 })
      const collapseToggle = targetSection.locator('[data-testid="diff-collapse-toggle"]')
      if (await collapseToggle.textContent() === 'Expand') {
        await collapseToggle.click()
      }

      await expect.poll(async () => targetSection.getByRole('button', { name: 'Keep hunk' }).count()).toBe(0)
      await expect.poll(async () => targetSection.getByRole('button', { name: 'Undo hunk' }).count()).toBe(0)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })

  test('rapid workspace switching does not let an older diff load overwrite the current workspace', async () => {
    const repoPath = createTestRepo('diff-switch-race')
    const { app, window } = await launchApp()

    try {
      const setup = await window.evaluate(async (repo: string) => {
        const getState = (window as any).__store.getState
        const store = getState()
        store.hydrateState({ projects: [], workspaces: [] })

        const projectId = crypto.randomUUID()
        store.addProject({ id: projectId, name: 'test-repo', repoPath: repo })

        const worktreeA = await (window as any).api.git.createWorktree(repo, 'diff-a', 'diff-a', true)
        const workspaceAId = crypto.randomUUID()
        store.addWorkspace({
          id: workspaceAId,
          name: 'diff-a',
          branch: 'diff-a',
          worktreePath: worktreeA,
          projectId,
        })

        const worktreeB = await (window as any).api.git.createWorktree(repo, 'diff-b', 'diff-b', true)
        const workspaceBId = crypto.randomUUID()
        store.addWorkspace({
          id: workspaceBId,
          name: 'diff-b',
          branch: 'diff-b',
          worktreePath: worktreeB,
          projectId,
        })

        return { workspaceAId, workspaceBId, worktreeA, worktreeB }
      }, repoPath)

      const realA = realpathSync(setup.worktreeA)
      const realB = realpathSync(setup.worktreeB)
      for (let i = 0; i < 35; i += 1) {
        writeFileSync(join(realA, `switch-a-${i}.ts`), `export const value${i} = ${i}\n`)
      }
      writeFileSync(join(realB, 'switch-b-only.ts'), 'export const winner = true\n')

      await window.evaluate(({ workspaceAId, workspaceBId }) => {
        const store = (window as any).__store.getState()
        store.setActiveWorkspace(workspaceAId)
        store.openDiffTab(workspaceAId)
        store.setActiveWorkspace(workspaceBId)
        store.openDiffTab(workspaceBId)
      }, {
        workspaceAId: setup.workspaceAId,
        workspaceBId: setup.workspaceBId,
      })

      await expect(window.locator('[class*="diffToolbar"]')).toBeVisible({ timeout: 10000 })
      await expect(window.locator('button', { hasText: 'switch-b-only.ts' })).toBeVisible({ timeout: 10000 })
      await expect(window.locator('button', { hasText: 'switch-a-0.ts' })).toHaveCount(0)
    } finally {
      await app.close()
      cleanupTestRepo(repoPath)
    }
  })
})
