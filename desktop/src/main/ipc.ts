import { ipcMain, dialog, app, BrowserWindow, clipboard, webContents, type WebContents } from 'electron'
import { join, relative } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { existsSync, mkdirSync, writeFileSync, realpathSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { watch, type FSWatcher } from 'fs'
import { execFile, type ExecFileException } from 'child_process'
import { promisify } from 'util'
import { IPC } from '../shared/ipc-channels'
import type { PlanAgent } from '../shared/agent-plan-path'
import type { CreateWorktreeProgressEvent } from '../shared/workspace-creation'
import type { WorktreeCredentialRule } from '../shared/worktree-credentials'
import { PtyManager, type PtyWriteOpts } from './pty-manager'
import { GitService } from './git-service'
import { WorktreeSyncService } from './worktree-sync-service'
import { GithubService } from './github-service'
import { FileService, type FileNode } from './file-service'
import { readPlanMeta } from './plan-meta'
import { AutomationEngine } from './automation-engine'
import type { AutomationConfigLike, AutomationWorkspaceEvent } from '../shared/automation-types'
import { trustPathForClaude, loadClaudeSettings, saveClaudeSettings, loadJsonFile, saveJsonFile } from './claude-config'
import { loadCodexConfigText, saveCodexConfigText, CODEX_CONFIG_PATH, CODEX_DIR } from './codex-config'
import { loadMcpServersFromConfig, removeServerFromConfig } from './mcp-config'
import { CLAUDE_CONFIG_PATH } from './claude-config'
import { LspService } from './lsp/lsp-service'
import { SkillsService } from './skills-service'
import { GraphiteService } from './graphite-service'
import { t3codeService } from './t3code-service.js'
import { ContextWindowService } from './context-window-service'
import { closeAllAgentFS } from './agentfs-service'
import { AnnotationService } from './annotation-service'
import { emitAutomationEvent, onAutomationEvent } from './automation-event-bus'
import { lookupPersistedProjectRepo } from './persisted-state'
import { GithubPollService } from './github-poll-service'
import { listPiModels } from './pi-models'

const ptyManager = new PtyManager()
const worktreeSyncService = new WorktreeSyncService()

const automationEngine = new AutomationEngine(ptyManager)
const githubPollService = new GithubPollService()
const lspService = new LspService()

const guestTabSwitchListeners = new Map<number, { inputListener: (...args: unknown[]) => void; destroyListener: () => void }>()
// Clear all review annotations when a GitHub PR merges
onAutomationEvent(async (event) => {
  if (event.type !== 'pr:merged' || !event.projectId) return
  const repoPath = lookupPersistedProjectRepo(event.projectId)
  if (!repoPath) {
    console.warn('[review-annotations] pr:merged — no repoPath for project', event.projectId)
    return
  }
  try {
    await AnnotationService.clearComments(repoPath)
    console.log('[review-annotations] cleared all annotations after PR merge', { projectId: event.projectId, repoPath })
    let normalizedRepoPath: string
    try {
      normalizedRepoPath = realpathSync(repoPath)
    } catch {
      normalizedRepoPath = repoPath
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.REVIEW_ANNOTATIONS_CLEARED, { repoPath: normalizedRepoPath })
      }
    }
  } catch (err) {
    console.error('[review-annotations] failed to clear after PR merge', err)
  }
})

interface FsWatchSubscriber {
  webContents: WebContents
  refs: number
}

interface FsWatcherEntry {
  watcher: FSWatcher
  timer: ReturnType<typeof setTimeout> | null
  subscribers: Map<number, FsWatchSubscriber>
  totalRefs: number
}

// Filesystem watchers keyed by watched directory.
// Each renderer subscription increments a ref count so one panel unmounting
// does not tear down a shared watcher used by another panel.
const fsWatchers = new Map<string, FsWatcherEntry>()

function sameWorktreePath(a: string, b: string): boolean {
  if (a === b) return true
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    return false
  }
}

interface StateSanitizeResult {
  data: unknown
  changed: boolean
  removedWorkspaceCount: number
}

interface WorkspaceLike {
  id: string
  worktreePath: string
}

interface TabLike {
  id: string
  workspaceId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isWorkspaceLike(value: unknown): value is WorkspaceLike {
  return isRecord(value) && typeof value.id === 'string' && typeof value.worktreePath === 'string'
}

function isTabLike(value: unknown): value is TabLike {
  return isRecord(value) && typeof value.id === 'string' && typeof value.workspaceId === 'string'
}

/**
 * macOS often stores `/var/...` while Node/git use `/private/var/...` (or the reverse).
 * A plain existsSync on the persisted string can falsely drop valid workspaces on load.
 */
function resolveWorktreePathIfExists(worktreePath: string): string | null {
  const trimmed = worktreePath.trim()
  if (!trimmed) return null
  const norm = trimmed.replace(/\/+$/, '') || '/'
  const variants = new Set<string>([trimmed, norm])
  if (norm.startsWith('/var/') && !norm.startsWith('/private/')) {
    variants.add('/private' + norm)
  }
  if (norm.startsWith('/private/var/')) {
    const stripped = norm.slice('/private'.length)
    if (stripped) variants.add(stripped)
  }
  for (const v of variants) {
    try {
      if (existsSync(v)) {
        return realpathSync(v)
      }
    } catch {
      // realpathSync can throw on race / permission
    }
  }
  return null
}

function sanitizeLoadedState(data: unknown): StateSanitizeResult {
  if (!isRecord(data)) return { data, changed: false, removedWorkspaceCount: 0 }
  const rawWorkspaces = Array.isArray(data.workspaces) ? data.workspaces : null
  if (!rawWorkspaces) return { data, changed: false, removedWorkspaceCount: 0 }

  const keptWorkspaces: unknown[] = []
  const keptWorkspaceIds = new Set<string>()
  let removedWorkspaceCount = 0
  let pathNormalized = false

  for (const workspace of rawWorkspaces) {
    if (!isWorkspaceLike(workspace)) {
      removedWorkspaceCount += 1
      continue
    }
    const resolved = resolveWorktreePathIfExists(workspace.worktreePath)
    if (!resolved) {
      removedWorkspaceCount += 1
      continue
    }
    keptWorkspaceIds.add(workspace.id)
    if (resolved === workspace.worktreePath) {
      keptWorkspaces.push(workspace)
    } else {
      pathNormalized = true
      keptWorkspaces.push({ ...workspace, worktreePath: resolved })
    }
  }

  if (removedWorkspaceCount === 0 && !pathNormalized) {
    return { data, changed: false, removedWorkspaceCount: 0 }
  }

  const next: Record<string, unknown> = { ...data, workspaces: keptWorkspaces }
  let changed = true

  const rawTabs = Array.isArray(data.tabs) ? data.tabs : null
  const keptTabs = rawTabs
    ? rawTabs.filter((tab) => isTabLike(tab) && keptWorkspaceIds.has(tab.workspaceId))
    : []
  if (rawTabs) next.tabs = keptTabs

  const rawActiveWorkspaceId = typeof data.activeWorkspaceId === 'string' ? data.activeWorkspaceId : null
  let nextActiveWorkspaceId: string | null = null
  if (rawActiveWorkspaceId && keptWorkspaceIds.has(rawActiveWorkspaceId)) {
    nextActiveWorkspaceId = rawActiveWorkspaceId
  } else {
    const firstWorkspace = keptWorkspaces.find(isWorkspaceLike)
    nextActiveWorkspaceId = firstWorkspace?.id ?? null
  }
  if ((data.activeWorkspaceId ?? null) !== nextActiveWorkspaceId) {
    changed = true
  }
  next.activeWorkspaceId = nextActiveWorkspaceId

  const rawActiveTabId = typeof data.activeTabId === 'string' ? data.activeTabId : null
  let nextActiveTabId: string | null = null
  if (rawTabs) {
    const tabIds = new Set<string>()
    for (const tab of keptTabs) {
      if (isTabLike(tab)) tabIds.add(tab.id)
    }
    if (rawActiveTabId && tabIds.has(rawActiveTabId)) {
      nextActiveTabId = rawActiveTabId
    } else if (nextActiveWorkspaceId) {
      const fallback = keptTabs.find(
        (tab) => isTabLike(tab) && tab.workspaceId === nextActiveWorkspaceId
      )
      if (isTabLike(fallback)) nextActiveTabId = fallback.id
    }
  }
  if ((data.activeTabId ?? null) !== nextActiveTabId) {
    changed = true
  }
  next.activeTabId = nextActiveTabId

  if (isRecord(data.lastActiveTabByWorkspace)) {
    const filtered = Object.fromEntries(
      Object.entries(data.lastActiveTabByWorkspace).filter(([workspaceId]) =>
        keptWorkspaceIds.has(workspaceId)
      )
    )
    if (
      Object.keys(filtered).length !==
      Object.keys(data.lastActiveTabByWorkspace).length
    ) {
      changed = true
    }
    next.lastActiveTabByWorkspace = filtered
  }

  return { data: next, changed, removedWorkspaceCount }
}

export function registerIpcHandlers(): void {
  // ── Git handlers ──
  ipcMain.handle(IPC.GIT_LIST_WORKTREES, async (_e, repoPath: string) => {
    return GitService.listWorktrees(repoPath)
  })

  ipcMain.handle(IPC.GIT_CHECK_IS_REPO, async (_e, dirPath: string) => {
    return GitService.isGitRepo(dirPath)
  })

  ipcMain.handle(IPC.GIT_INIT_REPO, async (_e, dirPath: string) => {
    return GitService.initRepo(dirPath)
  })

  ipcMain.handle(IPC.GIT_CREATE_WORKTREE, async (_e, repoPath: string, name: string, branch: string, newBranch: boolean, baseBranch?: string, force?: boolean, requestId?: string, credentialRules?: WorktreeCredentialRule[]) => {
    return GitService.createWorktree(
      repoPath,
      name,
      branch,
      newBranch,
      baseBranch,
      force,
      (progress) => {
        const payload: CreateWorktreeProgressEvent = { requestId, ...progress }
        _e.sender.send(IPC.GIT_CREATE_WORKTREE_PROGRESS, payload)
      },
      credentialRules,
    )
  })

  ipcMain.handle(IPC.GIT_CREATE_WORKTREE_FROM_PR, async (_e, repoPath: string, name: string, prNumber: number, localBranch: string, force?: boolean, requestId?: string, credentialRules?: WorktreeCredentialRule[]) => {
    return GitService.createWorktreeFromPr(
      repoPath,
      name,
      prNumber,
      localBranch,
      force,
      (progress) => {
        const payload: CreateWorktreeProgressEvent = { requestId, ...progress }
        _e.sender.send(IPC.GIT_CREATE_WORKTREE_PROGRESS, payload)
      },
      credentialRules,
    )
  })

  ipcMain.handle(IPC.GIT_REMOVE_WORKTREE, async (_e, repoPath: string, worktreePath: string) => {
    return GitService.removeWorktree(repoPath, worktreePath)
  })

  ipcMain.handle(IPC.GIT_GET_STATUS, async (_e, worktreePath: string) => {
    return GitService.getStatus(worktreePath)
  })

  ipcMain.handle(IPC.GIT_GET_DIFF, async (_e, worktreePath: string, staged: boolean) => {
    return GitService.getDiff(worktreePath, staged)
  })

  ipcMain.handle(IPC.GIT_GET_FILE_DIFF, async (_e, worktreePath: string, filePath: string) => {
    return GitService.getFileDiff(worktreePath, filePath)
  })

  ipcMain.handle(IPC.GIT_GET_BRANCHES, async (_e, repoPath: string) => {
    return GitService.getBranches(repoPath)
  })

  ipcMain.handle(IPC.GIT_STAGE, async (_e, worktreePath: string, paths: string[]) => {
    return GitService.stage(worktreePath, paths)
  })

  ipcMain.handle(IPC.GIT_UNSTAGE, async (_e, worktreePath: string, paths: string[]) => {
    return GitService.unstage(worktreePath, paths)
  })

  ipcMain.handle(IPC.GIT_DISCARD, async (_e, worktreePath: string, paths: string[], untracked: string[]) => {
    return GitService.discard(worktreePath, paths, untracked)
  })

  ipcMain.handle(IPC.GIT_COMMIT, async (_e, worktreePath: string, message: string) => {
    return GitService.commit(worktreePath, message)
  })

  ipcMain.handle(IPC.GIT_PUSH_CURRENT_BRANCH, async (_e, worktreePath: string) => {
    return GitService.pushCurrentBranch(worktreePath)
  })

  ipcMain.handle(IPC.GIT_GET_CURRENT_BRANCH, async (_e, worktreePath: string) => {
    return GitService.getCurrentBranch(worktreePath)
  })

  ipcMain.handle(IPC.GIT_GET_DEFAULT_BRANCH, async (_e, repoPath: string) => {
    return GitService.getDefaultBranch(repoPath)
  })

  ipcMain.handle(IPC.GIT_SHOW_FILE_AT_HEAD, async (_e, worktreePath: string, filePath: string) => {
    return GitService.showFileAtHead(worktreePath, filePath)
  })

  ipcMain.handle(IPC.GIT_GET_LOG, async (_e, worktreePath: string, maxCount?: number) => {
    return GitService.getLog(worktreePath, maxCount)
  })

  ipcMain.handle(IPC.GIT_GET_COMMIT_DIFF, async (_e, worktreePath: string, hash: string) => {
    return GitService.getCommitDiff(worktreePath, hash)
  })

  ipcMain.handle(IPC.GIT_GET_REMOTE_HEAD, async (_e, repoPath: string) => {
    return GitService.getRemoteHead(repoPath)
  })

  ipcMain.handle(IPC.GIT_SYNC_ALL_WORKTREES, async (_e, projectId: string) => {
    await worktreeSyncService.syncNow(projectId)
  })

  ipcMain.handle(IPC.GIT_START_SYNC_POLLING, async (_e, projectId: string, repoPath: string) => {
    worktreeSyncService.startPolling(projectId, repoPath)
  })

  ipcMain.handle(IPC.GIT_STOP_SYNC_POLLING, async (_e, projectId: string) => {
    worktreeSyncService.stopPolling(projectId)
  })

  ipcMain.on(IPC.GIT_SYNC_SET_BUSY, (_e, paths: unknown) => {
    if (!Array.isArray(paths)) return
    const strings = paths.filter((p): p is string => typeof p === 'string')
    worktreeSyncService.setBusyWorktrees(strings)
  })

  // ── GitHub handlers ──
  ipcMain.handle(IPC.GITHUB_GET_PR_STATUSES, async (_e, repoPath: string, branches: string[]) => {
    return GithubService.getPrStatuses(repoPath, branches)
  })

  ipcMain.handle(IPC.GITHUB_LIST_OPEN_PRS, async (_e, repoPath: string) => {
    return GithubService.listOpenPrs(repoPath)
  })

  ipcMain.handle(IPC.GITHUB_RESOLVE_PR, async (_e, repoPath: string, prNumber: number, repoSlug?: string) => {
    return GithubService.resolvePr(repoPath, prNumber, repoSlug)
  })

  ipcMain.handle(IPC.GITHUB_CREATE_PR, async (_e, repoPath: string, headBranch: string, baseBranch: string) => {
    return GithubService.createPr(repoPath, headBranch, baseBranch)
  })

  ipcMain.handle(IPC.GITHUB_REOPEN_PR, async (_e, repoPath: string, prNumber: number) => {
    return GithubService.reopenPr(repoPath, prNumber)
  })

  ipcMain.handle(IPC.GITHUB_GET_PR_REVIEW_COMMENTS, async (_e, repoPath: string, prNumber: number) => {
    return GithubService.fetchPrReviewComments(repoPath, prNumber)
  })

  // ── Graphite handlers ──
  ipcMain.handle(IPC.GRAPHITE_GET_STACK, async (_e, repoPath: string, worktreePath: string) => {
    return GraphiteService.getStackInfo(repoPath, worktreePath)
  })

  ipcMain.handle(IPC.GRAPHITE_CHECKOUT_BRANCH, async (_e, worktreePath: string, branch: string) => {
    return GraphiteService.checkoutBranch(worktreePath, branch)
  })

  ipcMain.handle(IPC.GRAPHITE_CLONE_STACK, async (_e, repoPath: string, name: string, prBranches: { name: string; parent: string | null }[], credentialRules?: WorktreeCredentialRule[]) => {
    return GraphiteService.cloneStack(repoPath, name, prBranches, credentialRules)
  })

  ipcMain.handle(IPC.GRAPHITE_GET_STACK_FOR_PR, async (_e, repoPath: string, prBranch: string) => {
    return GraphiteService.getStackForPr(repoPath, prBranch)
  })

  ipcMain.handle(IPC.GRAPHITE_GET_CREATE_OPTIONS, async (_e, repoPath: string) => {
    return GraphiteService.getCreateOptions(repoPath)
  })

  ipcMain.handle(IPC.GRAPHITE_SET_BRANCH_PARENT, async (_e, repoPath: string, branch: string, parent: string) => {
    return GraphiteService.setBranchParent(repoPath, branch, parent)
  })

  // ── PTY handlers ──
  ipcMain.handle(IPC.PTY_CREATE, async (_e, workingDir: string, shell?: string, extraEnv?: Record<string, string>) => {
    const win = BrowserWindow.fromWebContents(_e.sender)
    if (!win) throw new Error('No window found')
    return ptyManager.create(workingDir, win.webContents, shell, undefined, undefined, extraEnv)
  })

  ipcMain.on(IPC.PTY_WRITE, (_e, ptyId: string, data: string, opts?: PtyWriteOpts) => {
    ptyManager.write(ptyId, data, opts)
  })

  ipcMain.on(IPC.PTY_SUGGEST_TAB_TITLE, (_e, ptyId: string, line: string) => {
    if (typeof ptyId === 'string' && typeof line === 'string') {
      console.log('[constellagent:tab-title] IPC PTY_SUGGEST_TAB_TITLE', {
        ptyId,
        lineByteLength: Buffer.byteLength(line, 'utf8'),
        linePreview: line.replace(/\r/g, '\\r').replace(/\n/g, '\\n').slice(0, 72),
      })
      ptyManager.suggestTabTitle(ptyId, line)
    }
  })

  ipcMain.on(IPC.PTY_RESIZE, (_e, ptyId: string, cols: number, rows: number) => {
    ptyManager.resize(ptyId, cols, rows)
  })

  ipcMain.on(IPC.PTY_DESTROY, (_e, ptyId: string) => {
    ptyManager.destroy(ptyId)
  })

  ipcMain.handle(IPC.PTY_LIST, async () => {
    return ptyManager.list()
  })

  ipcMain.handle(IPC.PTY_REATTACH, async (_e, ptyId: string) => {
    const win = BrowserWindow.fromWebContents(_e.sender)
    if (!win) throw new Error('No window found')
    return ptyManager.reattach(ptyId, win.webContents)
  })

  // ── File handlers ──
  ipcMain.handle(IPC.FS_GET_TREE, async (_e, dirPath: string) => {
    return FileService.getTree(dirPath)
  })

  ipcMain.handle(IPC.FS_GET_TREE_WITH_STATUS, async (_e, dirPath: string) => {
    const [tree, statuses, topLevel] = await Promise.all([
      FileService.getTree(dirPath),
      GitService.getStatus(dirPath).catch(() => []),
      GitService.getTopLevel(dirPath).catch(() => dirPath),
    ])

    // git status --porcelain paths are relative to repo root, but
    // git ls-files paths (used for the tree) are relative to cwd (dirPath).
    // Compute prefix to convert between them.
    const prefix = relative(topLevel, dirPath) // e.g. 'desktop' or ''

    // Build map: dirPath-relative path → git status
    const statusMap = new Map<string, string>()
    for (const s of statuses) {
      let p = s.path
      // Handle renamed files: "old -> new" — use the new path
      if (p.includes(' -> ')) {
        p = p.split(' -> ')[1]
      }
      // Strip repo-root prefix to get dirPath-relative path
      if (prefix && p.startsWith(prefix + '/')) {
        p = p.slice(prefix.length + 1)
      }
      statusMap.set(p, s.status)
    }

    // Attach gitStatus to nodes, propagate to parent dirs
    function annotate(nodes: FileNode[]): boolean {
      let hasStatus = false
      for (const node of nodes) {
        // Compute relative path from dirPath
        const rel = node.path.startsWith(dirPath)
          ? node.path.slice(dirPath.length + 1)
          : node.path

        if (node.type === 'file') {
          const st = statusMap.get(rel)
          if (st) {
            node.gitStatus = st as FileNode['gitStatus']
            hasStatus = true
          }
        } else if (node.children) {
          const childHasStatus = annotate(node.children)
          if (childHasStatus) {
            node.gitStatus = 'modified'
            hasStatus = true
          }
        }
      }
      return hasStatus
    }

    annotate(tree)
    return tree
  })

  ipcMain.handle(IPC.FS_READ_FILE, async (_e, filePath: string) => {
    try {
      return await FileService.readFile(filePath)
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'EISDIR') {
        return null
      }
      throw err
    }
  })

  ipcMain.handle(IPC.FS_WRITE_FILE, async (_e, filePath: string, content: string) => {
    return FileService.writeFile(filePath, content)
  })

  ipcMain.handle(IPC.FS_DELETE_FILE, async (_e, filePath: string) => {
    return FileService.deleteFile(filePath)
  })

  ipcMain.handle(IPC.FS_FIND_NEWEST_PLAN, async (_e, worktreePath: string | string[]) => {
    return FileService.findNewestPlanMarkdown(worktreePath)
  })

  ipcMain.handle(IPC.FS_LIST_AGENT_PLANS, async (_e, worktreePath: string | string[]) => {
    return FileService.listAgentPlanMarkdowns(worktreePath)
  })

  ipcMain.handle(IPC.FS_READ_PLAN_META, async (_e, filePath: string) => {
    return readPlanMeta(filePath)
  })

  ipcMain.handle(IPC.FS_UPDATE_PLAN_META, async (_e, filePath: string, patch: { built?: boolean; codingAgent?: string | null; buildHarness?: PlanAgent | null }) => {
    return FileService.updatePlanMeta(filePath, patch)
  })

  ipcMain.handle(IPC.FS_RELOCATE_AGENT_PLAN, async (_e, worktreePath: string, filePath: string, targetAgent: string, mode: string) => {
    return FileService.relocateAgentPlan(worktreePath, filePath, targetAgent as any, mode as any)
  })

  // ── Filesystem watcher handlers ──
  ipcMain.handle(IPC.FS_WATCH_START, (_e, dirPath: string) => {
    const senderId = _e.sender.id
    const existing = fsWatchers.get(dirPath)
    if (existing) {
      const subscriber = existing.subscribers.get(senderId)
      if (subscriber) {
        subscriber.refs += 1
      } else {
        existing.subscribers.set(senderId, { webContents: _e.sender, refs: 1 })
      }
      existing.totalRefs += 1
      return
    }

    try {
      const watcher = watch(dirPath, { recursive: true }, (_eventType, filename) => {
        // For .git/ changes, only notify on meaningful state changes (commit, stage, branch switch)
        // Ignore noisy internals like objects/, logs/, COMMIT_EDITMSG
        if (filename && (filename.startsWith('.git/') || filename.startsWith('.git\\'))) {
          const f = filename.replaceAll('\\', '/')
          const isStateChange =
            f === '.git/index' || f === '.git/HEAD' || f.startsWith('.git/refs/')
          if (!isStateChange) return
        }

        const entry = fsWatchers.get(dirPath)
        if (!entry) return

        // Debounce: wait 500ms of quiet before notifying
        if (entry.timer) clearTimeout(entry.timer)
        entry.timer = setTimeout(() => {
          for (const [id, subscriber] of entry.subscribers.entries()) {
            if (subscriber.webContents.isDestroyed()) {
              entry.totalRefs = Math.max(0, entry.totalRefs - subscriber.refs)
              entry.subscribers.delete(id)
              continue
            }
            subscriber.webContents.send(IPC.FS_WATCH_CHANGED, dirPath)
          }

          if (entry.totalRefs <= 0 || entry.subscribers.size === 0) {
            if (entry.timer) clearTimeout(entry.timer)
            entry.watcher.close()
            fsWatchers.delete(dirPath)
          }
        }, 500)
      })

      fsWatchers.set(dirPath, {
        watcher,
        timer: null,
        subscribers: new Map([[senderId, { webContents: _e.sender, refs: 1 }]]),
        totalRefs: 1,
      })
    } catch {
      // Directory may not exist or be inaccessible — ignore
    }
  })

  ipcMain.on(IPC.FS_WATCH_STOP, (_e, dirPath: string) => {
    const entry = fsWatchers.get(dirPath)
    if (!entry) return

    const senderId = _e.sender.id
    const subscriber = entry.subscribers.get(senderId)
    if (subscriber) {
      subscriber.refs -= 1
      entry.totalRefs = Math.max(0, entry.totalRefs - 1)
      if (subscriber.refs <= 0) {
        entry.subscribers.delete(senderId)
      }
    } else {
      entry.totalRefs = Math.max(0, entry.totalRefs - 1)
    }

    if (entry.totalRefs <= 0 || entry.subscribers.size === 0) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.watcher.close()
      fsWatchers.delete(dirPath)
    }
  })

  // ── App handlers ──
  ipcMain.handle(IPC.APP_SELECT_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Repository',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.APP_GET_HOME_DIR, () => homedir())

  ipcMain.handle(IPC.APP_LIST_PI_MODELS, async () => {
    return listPiModels()
  })

  // Accepts a path directly (for testing — avoids dialog.showOpenDialog)
  ipcMain.handle(IPC.APP_ADD_PROJECT_PATH, async (_e, dirPath: string) => {
    const { stat } = await import('fs/promises')
    try {
      const s = await stat(dirPath)
      if (!s.isDirectory()) return null
      return dirPath
    } catch {
      return null
    }
  })

  // ── Open in external editor ──
  const execFileAsync = promisify(execFile)

  ipcMain.handle(IPC.APP_OPEN_IN_EDITOR, async (_e, dirPath: string, cliCommand: string, extraArgs?: string[], openMode?: string) => {
    try {
      await execFileAsync(cliCommand, [...(extraArgs || []), dirPath])

      if (openMode === 'agents-window' && process.platform === 'darwin') {
        await new Promise(r => setTimeout(r, 800))
        try {
          await execFileAsync('osascript', ['-e', [
            'tell application "Cursor" to activate',
            'delay 0.3',
            'tell application "System Events" to tell process "Cursor"',
            '  keystroke "p" using {command down, shift down}',
            '  delay 0.3',
            '  keystroke "View: New Agents Window"',
            '  delay 0.2',
            '  key code 36',
            'end tell',
          ].join('\n')])
        } catch {
          // Best-effort: requires accessibility permissions
        }
      }

      return { success: true }
    } catch (err) {
      const msg = (err as ExecFileException).message || `Failed to open ${cliCommand}`
      return { success: false, error: msg }
    }
  })

  // ── Claude Code context window ──
  const contextWindowService = new ContextWindowService()
  ipcMain.handle(IPC.CLAUDE_CONTEXT_WINDOW, async (_e, worktreePath: string) => {
    return contextWindowService.getUsage(worktreePath)
  })

  // ── Claude Code trust ──
  ipcMain.handle(IPC.CLAUDE_TRUST_PATH, async (_e, dirPath: string) => {
    await trustPathForClaude(dirPath)
  })

  // ── Claude Code hooks ──
  function getHookScriptPath(name: string): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'claude-hooks', name)
    }
    return join(__dirname, '..', '..', 'claude-hooks', name)
  }

  function getCodexHookScriptPath(name: string): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'codex-hooks', name)
    }
    return join(__dirname, '..', '..', 'codex-hooks', name)
  }

  const ACTIVE_CLAUDE_HOOK_IDENTIFIERS = [
    'claude-hooks/notify.sh',
    'claude-hooks/activity.sh',
    'claude-hooks/session-save.sh',
  ]

  const LEGACY_CLAUDE_HOOK_IDENTIFIERS = [
    'claude-hooks/context-capture.sh',
    'claude-hooks/context-inject.sh',
    'agent-hooks/claude-capture.sh',
  ]

  function shellQuoteArg(value: string): string {
    // Claude executes hook commands via /bin/sh; paths can contain spaces.
    return `'${value.replace(/'/g, `'\"'\"'`)}'`
  }

  function hasClaudeHookIdentifier(
    rule: { hooks?: Array<{ command?: string }> },
    identifiers: string[],
  ): boolean {
    return !!rule.hooks?.some((h) => identifiers.some((id) => h.command?.includes(id)))
  }

  function isManagedClaudeHook(rule: { hooks?: Array<{ command?: string }> }): boolean {
    return hasClaudeHookIdentifier(rule, [...ACTIVE_CLAUDE_HOOK_IDENTIFIERS, ...LEGACY_CLAUDE_HOOK_IDENTIFIERS])
  }

  ipcMain.handle(IPC.CLAUDE_CHECK_HOOKS, async () => {
    const settings = await loadClaudeSettings()
    const hooks = settings.hooks as Record<string, unknown[]> | undefined
    if (!hooks) return { installed: false }

    const hasStop = (hooks.Stop as Array<{ hooks?: Array<{ command?: string }> }> | undefined)?.some(
      (rule) => hasClaudeHookIdentifier(rule, ['claude-hooks/notify.sh', 'claude-hooks/session-save.sh']),
    )
    const hasNotification = (hooks.Notification as Array<{ hooks?: Array<{ command?: string }> }> | undefined)?.some(
      (rule) => hasClaudeHookIdentifier(rule, ['claude-hooks/notify.sh']),
    )
    const hasPromptSubmit = (hooks.UserPromptSubmit as Array<{ hooks?: Array<{ command?: string }> }> | undefined)?.some(
      (rule) => hasClaudeHookIdentifier(rule, ['claude-hooks/activity.sh']),
    )
    return {
      installed: !!(hasStop && hasNotification && hasPromptSubmit),
    }
  })

  ipcMain.handle(IPC.CLAUDE_INSTALL_HOOKS, async () => {
    const settings = await loadClaudeSettings()
    const notifyPath = getHookScriptPath('notify.sh')
    const activityPath = getHookScriptPath('activity.sh')
    const sessionSavePath = getHookScriptPath('session-save.sh')

    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>

    // Helper: strip all our hooks from an event, then add the specified ones
    function setHooks(event: string, entries: Array<{ scriptPath: string; matcher?: string }>) {
      const rules = (hooks[event] ?? []) as Array<Record<string, unknown>>
      const filtered = rules.filter((rule) => !isManagedClaudeHook(rule as { hooks?: Array<{ command?: string }> }))
      for (const entry of entries) {
        filtered.push({ matcher: entry.matcher ?? '', hooks: [{ type: 'command', command: shellQuoteArg(entry.scriptPath) }] })
      }
      hooks[event] = filtered
      if (filtered.length === 0) delete hooks[event]
    }

    setHooks('Notification', [{ scriptPath: notifyPath }])
    setHooks('Stop', [{ scriptPath: notifyPath }, { scriptPath: sessionSavePath }])
    setHooks('UserPromptSubmit', [{ scriptPath: activityPath }])
    setHooks('PostToolUse', [])
    setHooks('SessionStart', [])
    setHooks('SessionEnd', [])
    setHooks('PreToolUse', [])
    setHooks('PostToolUseFailure', [])
    setHooks('SubagentStart', [])
    setHooks('SubagentStop', [])

    settings.hooks = hooks

    await saveClaudeSettings(settings)
    return { success: true }
  })

  ipcMain.handle(IPC.CLAUDE_UNINSTALL_HOOKS, async () => {
    const settings = await loadClaudeSettings()
    const hooks = settings.hooks as Record<string, unknown[]> | undefined
    if (!hooks) return { success: true }

    function removeHook(event: string) {
      const rules = (hooks![event] ?? []) as Array<{ hooks?: Array<{ command?: string }> }>
      hooks![event] = rules.filter((rule) => !isManagedClaudeHook(rule))
      if ((hooks![event] as unknown[]).length === 0) delete hooks![event]
    }

    removeHook('Stop')
    removeHook('Notification')
    removeHook('UserPromptSubmit')
    removeHook('PostToolUse')
    removeHook('SessionStart')
    removeHook('SessionEnd')
    removeHook('PreToolUse')
    removeHook('PostToolUseFailure')
    removeHook('SubagentStart')
    removeHook('SubagentStop')

    if (Object.keys(hooks).length === 0) delete settings.hooks
    await saveClaudeSettings(settings)
    return { success: true }
  })

  // ── Session resume ──
  ipcMain.handle(IPC.SESSION_GET_LAST, async (_e, workspaceId: string, agentType: string) => {
    const sessionDir = join(tmpdir(), 'constellagent-sessions')
    const filePath = join(sessionDir, `${workspaceId}.${agentType}`)
    try {
      const { readFile } = await import('fs/promises')
      return (await readFile(filePath, 'utf-8')).trim() || null
    } catch { return null }
  })

  // ── Codex notify hook ──
  const CODEX_NOTIFY_IDENTIFIER = 'codex-hooks/notify.sh'
  const LEGACY_CODEX_NOTIFY_IDENTIFIER = 'codex-hooks/codex-combined.sh'
  const TABLE_HEADER_RE = /^\s*\[[^\n]+\]\s*$/m
  const NOTIFY_ASSIGNMENT_RE = /^\s*notify\s*=/

  function tomlEscape(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  }

  function firstTableHeaderIndex(configText: string): number {
    const match = configText.match(TABLE_HEADER_RE)
    return match?.index ?? -1
  }

  function topLevelSection(configText: string): string {
    const firstTableIndex = firstTableHeaderIndex(configText)
    return firstTableIndex === -1 ? configText : configText.slice(0, firstTableIndex)
  }

  function hasOurCodexNotify(configText: string): boolean {
    return topLevelSection(configText).includes(CODEX_NOTIFY_IDENTIFIER)
  }

  function hasLegacyCodexNotify(configText: string): boolean {
    return topLevelSection(configText).includes(LEGACY_CODEX_NOTIFY_IDENTIFIER)
  }

  function stripNotifyAssignments(configText: string, shouldStrip: (assignment: string) => boolean = () => true): string {
    const lines = configText.split('\n')
    const kept: string[] = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]
      if (!NOTIFY_ASSIGNMENT_RE.test(line)) {
        kept.push(line)
        i += 1
        continue
      }

      let end = i
      const startsArray = line.includes('[')
      const endsArray = line.includes(']')
      if (startsArray && !endsArray) {
        let j = i + 1
        while (j < lines.length) {
          end = j
          if (lines[j].includes(']')) break
          j += 1
        }
      }

      const assignment = lines.slice(i, end + 1).join('\n')
      if (!shouldStrip(assignment)) {
        kept.push(...lines.slice(i, end + 1))
      }
      i = end + 1
    }

    return kept.join('\n')
  }

  function insertTopLevelNotify(configText: string, notifyLine: string): string {
    const withoutNotify = configText.trimEnd()
    if (!withoutNotify) return `${notifyLine}\n`

    const firstTableIndex = firstTableHeaderIndex(withoutNotify)
    if (firstTableIndex === -1) {
      return `${withoutNotify}\n${notifyLine}\n`
    }

    const beforeTables = withoutNotify.slice(0, firstTableIndex).trimEnd()
    const tablesAndBelow = withoutNotify.slice(firstTableIndex).replace(/^\n+/, '')

    const rebuilt = beforeTables
      ? `${beforeTables}\n${notifyLine}\n\n${tablesAndBelow}`
      : `${notifyLine}\n\n${tablesAndBelow}`

    return `${rebuilt.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
  }

  ipcMain.handle(IPC.CODEX_CHECK_NOTIFY, async () => {
    const config = await loadCodexConfigText()
    return {
      installed: hasOurCodexNotify(config) || hasLegacyCodexNotify(config),
    }
  })

  ipcMain.handle(IPC.CODEX_INSTALL_NOTIFY, async () => {
    const notifyPath = getCodexHookScriptPath('notify.sh')
    const notifyLine = `notify = ["${tomlEscape(notifyPath)}"]`
    let config = await loadCodexConfigText()

    // `notify` must be at true top-level in TOML. Appending at EOF can accidentally
    // nest it under the last table (for example `[projects."..."]`), which Codex ignores.
    config = stripNotifyAssignments(config)
    config = insertTopLevelNotify(config, notifyLine)

    await saveCodexConfigText(config)
    return { success: true }
  })

  ipcMain.handle(IPC.CODEX_UNINSTALL_NOTIFY, async () => {
    let config = await loadCodexConfigText()
    if (!config.includes(CODEX_NOTIFY_IDENTIFIER) && !config.includes(LEGACY_CODEX_NOTIFY_IDENTIFIER)) return { success: true }

    config = stripNotifyAssignments(config, (assignment) => assignment.includes(CODEX_NOTIFY_IDENTIFIER) || assignment.includes(LEGACY_CODEX_NOTIFY_IDENTIFIER))
    config = config.replace(/\n{3,}/g, '\n\n').trimEnd()
    if (config) config += '\n'

    await saveCodexConfigText(config)
    return { success: true }
  })

  // ── MCP config ──
  ipcMain.handle(IPC.MCP_LOAD_SERVERS, async () => {
    return loadMcpServersFromConfig()
  })

  ipcMain.handle(IPC.MCP_REMOVE_SERVER, async (_e, serverName: string) => {
    await removeServerFromConfig(serverName)
    return { success: true }
  })

  ipcMain.handle(IPC.MCP_GET_CONFIG_PATHS, async () => {
    const home = homedir()
    const geminiDir = join(home, '.gemini')
    const geminiConfigPath = join(geminiDir, 'settings.json')
    const cursorDir = join(home, '.cursor')
    const cursorConfigPath = join(cursorDir, 'mcp.json')
    const piDir = join(home, '.pi')
    const piConfigPath = join(piDir, 'config.json')

    // Ensure claude config exists
    if (!existsSync(CLAUDE_CONFIG_PATH)) {
      await writeFile(CLAUDE_CONFIG_PATH, '{}', 'utf-8')
    }
    // Ensure codex config exists
    if (!existsSync(CODEX_CONFIG_PATH)) {
      await mkdir(CODEX_DIR, { recursive: true })
      await writeFile(CODEX_CONFIG_PATH, '', 'utf-8')
    }
    // Ensure gemini config exists
    if (!existsSync(geminiConfigPath)) {
      await mkdir(geminiDir, { recursive: true })
      await writeFile(geminiConfigPath, '{}', 'utf-8')
    }
    // Ensure cursor config exists
    if (!existsSync(cursorConfigPath)) {
      await mkdir(cursorDir, { recursive: true })
      await writeFile(cursorConfigPath, '{}', 'utf-8')
    }
    // Ensure Pi config exists
    if (!existsSync(piConfigPath)) {
      await mkdir(piDir, { recursive: true })
      await writeFile(piConfigPath, '{}', 'utf-8')
    }

    return {
      'claude-code': CLAUDE_CONFIG_PATH,
      'codex': CODEX_CONFIG_PATH,
      'gemini': geminiConfigPath,
      'cursor': cursorConfigPath,
      'pi-constell': piConfigPath,
    }
  })

  // ── Automation handlers ──
  ipcMain.handle(IPC.AUTOMATION_CREATE, async (_e, automation: AutomationConfigLike) => {
    automationEngine.upsert(automation)
  })

  ipcMain.handle(IPC.AUTOMATION_UPDATE, async (_e, automation: AutomationConfigLike) => {
    automationEngine.upsert(automation)
  })

  ipcMain.handle(IPC.AUTOMATION_DELETE, async (_e, automationId: string) => {
    automationEngine.remove(automationId)
  })

  ipcMain.handle(IPC.AUTOMATION_RUN_NOW, async (_e, automation: AutomationConfigLike) => {
    automationEngine.runNow(automation)
  })

  ipcMain.handle(IPC.AUTOMATION_STOP, async (_e, automationId: string) => {
    automationEngine.remove(automationId)
  })

  ipcMain.on(IPC.AUTOMATION_WORKSPACE_EVENT, (_e, payload: AutomationWorkspaceEvent) => {
    emitAutomationEvent({
      type: payload.type,
      timestamp: payload.timestamp ?? Date.now(),
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      branch: payload.branch,
      meta: payload.meta,
    })
  })

  // ── LSP handlers ──
  ipcMain.handle(IPC.LSP_GET_PORT, async () => {
    return lspService.start()
  })

  ipcMain.handle(IPC.LSP_GET_AVAILABLE_LANGUAGES, async () => {
    return lspService.getAvailableLanguages()
  })

  // ── App file picker ──
  ipcMain.handle(IPC.APP_SELECT_FILE, async (_e, filters?: { name: string; extensions: string[] }[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: 'Select File',
      filters: filters || [],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ── Skills & Subagents handlers ──
  ipcMain.handle(IPC.SKILLS_SCAN, async (_e, skillPath: string) => {
    return SkillsService.scanSkillDir(skillPath)
  })

  ipcMain.handle(IPC.SKILLS_SYNC, async (_e, skillPath: string, projectPath: string) => {
    await SkillsService.syncSkillToAgents(skillPath, projectPath)
  })

  ipcMain.handle(IPC.SKILLS_REMOVE, async (_e, skillName: string, projectPath: string) => {
    await SkillsService.removeSkillFromAgents(skillName, projectPath)
  })

  ipcMain.handle(IPC.SUBAGENTS_SCAN, async (_e, filePath: string) => {
    return SkillsService.scanSubagentFile(filePath)
  })

  ipcMain.handle(IPC.SUBAGENTS_SYNC, async (_e, subagentPath: string, projectPath: string) => {
    await SkillsService.syncSubagentToAgents(subagentPath, projectPath)
  })

  ipcMain.handle(IPC.SUBAGENTS_REMOVE, async (_e, subagentName: string, projectPath: string) => {
    await SkillsService.removeSubagentFromAgents(subagentName, projectPath)
  })

  // ── Skills & Subagents KV persistence ──
  ipcMain.handle(IPC.SKILLS_KV_SAVE, async (_e, projectPath: string, skill: { name: string; description: string; sourcePath: string; enabled: boolean }) => {
    await SkillsService.saveSkillToKV(projectPath, skill)
  })

  ipcMain.handle(IPC.SKILLS_KV_REMOVE, async (_e, projectPath: string, skillName: string) => {
    await SkillsService.removeSkillFromKV(projectPath, skillName)
  })

  ipcMain.handle(IPC.SKILLS_KV_LIST, async (_e, projectPath: string) => {
    return SkillsService.listSkillsFromKV(projectPath)
  })

  ipcMain.handle(IPC.SUBAGENTS_KV_SAVE, async (_e, projectPath: string, subagent: { name: string; description: string; sourcePath: string; tools?: string; enabled: boolean }) => {
    await SkillsService.saveSubagentToKV(projectPath, subagent)
  })

  ipcMain.handle(IPC.SUBAGENTS_KV_REMOVE, async (_e, projectPath: string, subagentName: string) => {
    await SkillsService.removeSubagentFromKV(projectPath, subagentName)
  })

  ipcMain.handle(IPC.SUBAGENTS_KV_LIST, async (_e, projectPath: string) => {
    return SkillsService.listSubagentsFromKV(projectPath)
  })

  // ── Clipboard handlers ──
  ipcMain.handle(IPC.CLIPBOARD_SAVE_IMAGE, async () => {
    const img = clipboard.readImage()
    if (img.isEmpty()) return null
    const buf = img.toPNG()
    const filePath = join(tmpdir(), `constellagent-paste-${Date.now()}.png`)
    await writeFile(filePath, buf)
    return filePath
  })

  // ── Review annotations (libSQL-backed) ──
  ipcMain.handle(IPC.REVIEW_COMMENT_ADD, async (_e, worktreePath: string, file: string, newLine: number, summary: string, opts?: { rationale?: string; author?: string; focus?: boolean; oldLine?: number; force?: boolean; lineEnd?: number; workspaceId?: string }) => {
    await AnnotationService.addComment(worktreePath, file, newLine, summary, opts)
  })

  ipcMain.handle(IPC.REVIEW_COMMENT_LIST, async (_e, worktreePath: string, file?: string) => {
    return AnnotationService.listComments(worktreePath, file)
  })

  ipcMain.handle(IPC.REVIEW_COMMENT_REMOVE, async (_e, worktreePath: string, commentId: string) => {
    await AnnotationService.removeComment(worktreePath, commentId)
  })

  ipcMain.handle(IPC.REVIEW_COMMENT_CLEAR, async (_e, worktreePath: string, file?: string) => {
    await AnnotationService.clearComments(worktreePath, file)
  })

  ipcMain.handle(IPC.REVIEW_COMMENT_RESOLVE, async (_e, worktreePath: string, commentId: string, resolved: boolean) => {
    await AnnotationService.setResolved(worktreePath, commentId, resolved)
  })

  // ── T3 Code server handlers ──
  ipcMain.handle(IPC.T3CODE_START, async (_e, cwd: string) => {
    return t3codeService.start(cwd)
  })

  ipcMain.handle(IPC.T3CODE_STOP, async (_e, cwd: string) => {
    t3codeService.stop(cwd)
  })

  // ── Webview guest tab-switch interception ──
  // Electron <webview> guests swallow keyboard events; register before-input-event
  // on the guest WebContents so ⌘⌥←/→ still switches tabs.

  function unregisterGuestTabSwitch(guestId: number): void {
    const entry = guestTabSwitchListeners.get(guestId)
    if (!entry) return
    const guest = webContents.fromId(guestId)
    if (guest && !guest.isDestroyed()) {
      guest.off('before-input-event', entry.inputListener as never)
      guest.off('destroyed', entry.destroyListener as never)
    }
    guestTabSwitchListeners.delete(guestId)
  }

  ipcMain.handle(IPC.WEBVIEW_REGISTER_TAB_SWITCH, (_e, guestId: number) => {
    unregisterGuestTabSwitch(guestId)
    const guest = webContents.fromId(guestId)
    if (!guest || guest.isDestroyed()) return

    const hostSender = _e.sender

    const inputListener = (_ev: Electron.Event, input: Electron.Input) => {
      if (input.type !== 'keyDown') return
      if (!(input.meta || input.control) || !input.alt || input.shift) return
      if (input.key === 'ArrowLeft') {
        _ev.preventDefault()
        if (!hostSender.isDestroyed()) hostSender.send(IPC.WEBVIEW_TAB_PREV)
      } else if (input.key === 'ArrowRight') {
        _ev.preventDefault()
        if (!hostSender.isDestroyed()) hostSender.send(IPC.WEBVIEW_TAB_NEXT)
      }
    }

    const destroyListener = () => unregisterGuestTabSwitch(guestId)

    guest.on('before-input-event', inputListener)
    guest.once('destroyed', destroyListener)
    guestTabSwitchListeners.set(guestId, { inputListener: inputListener as never, destroyListener })
  })

  ipcMain.handle(IPC.WEBVIEW_UNREGISTER_TAB_SWITCH, (_e, guestId: number) => {
    unregisterGuestTabSwitch(guestId)
  })

  // ── State persistence handlers ──
  const stateFilePath = () =>
    join(app.getPath('userData'), 'constellagent-state.json')

  ipcMain.handle(IPC.STATE_SAVE, async (_e, data: unknown) => {
    await mkdir(app.getPath('userData'), { recursive: true })
    await saveJsonFile(stateFilePath(), data)
  })

  // Synchronous save for beforeunload — guarantees state is written before window closes
  ipcMain.on(IPC.STATE_SAVE_SYNC, (event, data: unknown) => {
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(stateFilePath(), JSON.stringify(data, null, 2), 'utf-8')
      event.returnValue = true
    } catch {
      event.returnValue = false
    }
  })

  ipcMain.handle(IPC.STATE_LOAD, async () => {
    const loaded = await loadJsonFile(stateFilePath(), null)
    const sanitized = sanitizeLoadedState(loaded)
    if (sanitized.changed) {
      await saveJsonFile(stateFilePath(), sanitized.data).catch(() => {})
      const count = sanitized.removedWorkspaceCount
      if (count > 0) {
        console.info(`[state] removed ${count} stale workspace${count === 1 ? '' : 's'}`)
      }
    }
    return sanitized.data
  })
}

export function getGithubPollService(): GithubPollService {
  return githubPollService
}

/** Kill all PTY processes and stop all automation jobs. Call on app quit. */
export function cleanupAll(): void {
  worktreeSyncService.stopAll()
  ptyManager.destroyAll()
  automationEngine.destroyAll()
  githubPollService.stop()
  lspService.shutdown()
  AnnotationService.cleanupAll()
  t3codeService.stopAll()
  guestTabSwitchListeners.clear()
  closeAllAgentFS().catch(() => {})
}
