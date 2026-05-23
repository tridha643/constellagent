import { ipcMain, dialog, app, BrowserWindow, clipboard, webContents, shell, type WebContents } from 'electron'
import { join, relative } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { existsSync, mkdirSync, writeFileSync, realpathSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { watch, type FSWatcher } from 'fs'
import { execFile, type ExecFileException } from 'child_process'
import { promisify } from 'util'
import { IPC } from '../shared/ipc-channels'
import type { HostUiResponse } from '@pi-gui/session-driver'
import type { PlanAgent } from '../shared/agent-plan-path'
import type { CreateWorktreeProgressEvent } from '../shared/workspace-creation'
import type { CloneRepoOptions, CloneRepoProgressEvent, CloneRepoResult } from '../shared/clone-repo'
import { CLONE_ERROR_CODES } from '../shared/clone-repo'
import { parseGithubUrl } from '../shared/github-url'
import type { WorktreeCredentialRule } from '../shared/worktree-credentials'
import type { GraphiteStackAction } from '../shared/graphite-types'
import type { GitHunkActionRequest } from '../shared/git-hunk-action-types'
import { PtyManager, type PtyWriteOpts } from './pty-manager'
import { readPackageScripts } from './package-scripts-service'
import { GitService, RebaseConflictError } from './git-service'
import { WorktreeSyncService } from './worktree-sync-service'
import { SpotlightService } from './spotlight-service'
import { GithubService } from './github-service'
import { FileService, type FileNode } from './file-service'
import { LinearFffService } from './linear-fff-service'
import type { LinearFffQuickOpenRequest } from '../shared/linear-fff-types'
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
import { ContextWindowService } from './context-window-service'
import { CodexUsageService } from './codex-usage-service'
import { CursorUsageService } from './cursor-usage-service'
import { closeAllAgentFS } from './agentfs-service'
import { AnnotationService } from './annotation-service'
import { emitAutomationEvent, onAutomationEvent } from './automation-event-bus'
import { lookupPersistedProjectRepo, readPersistedPiCommitMessageModel } from './persisted-state'
import { GithubPollService } from './github-poll-service'
import { listPiModels } from './pi-models'
import { CommitMessageService } from './commit-message-service'
import { LinearDraftService } from './linear-draft-service'
import { requestAppRelaunch } from './app-relaunch'
import { measureMainAsync } from './perf'
import {
  deleteProjectStartupCommands,
  getProjectStartupCommands,
  getProjectStartupSettingsPath,
  listProjectStartupSettings,
  setProjectStartupCommands,
} from './project-startup-settings'
import { getConstellPiHost } from './pi-host-service'
import { getAgentChatHost, type CreateAgentChatSessionInput } from './agent-chat-host'
import type { ForkAgentChatSessionInput } from '../shared/agent-chat-types'
import {
  applyConductorAuthFromPersistedState,
  getConductorAuthStatus,
  setConductorAuthKeys,
} from './conductor-auth'
import {
  applyConductorSettingsFromPersistedState,
  setConductorCodexWebSocketsSetting,
} from './conductor-settings'
import type { CodexWebSocketsSetting } from '../shared/codex-websockets'
import type { ComposerAttachment } from '../shared/pi/pi-desktop-state'
import { type ComposioWebhookSettings, isComposioAutomationAgent } from '../shared/composio-types'
import { composioWebhookService } from './composio-webhook-service'
import { composioNgrokService } from './composio-ngrok-service'
import { composioSubscribeTriggerWebhookWithKeyFallback } from './composio-webhook-subscriptions'
import { composioTriggerUpsertWithCliFallback, composioSuggestGithubConnectedAccountId } from './composio-trigger-client'
import { parseComposioPiAutomationDraft } from './composio-pi-draft'
import { AutomationRunner } from './automations/automation-runner'
import { AutomationDeliveryRouter } from './automations/delivery-router'
import {
  listComposioAutomationDefinitions,
  setComposioAutomationDefinitionAgent,
  setComposioAutomationDefinitionEnabled,
  setComposioAutomationDefinitionInstructions,
} from './automations/composio-definition-store'

const ptyManager = new PtyManager()
const worktreeSyncService = new WorktreeSyncService()
const spotlightService = new SpotlightService()

const automationEngine = new AutomationEngine(ptyManager)
const automationRunner = new AutomationRunner(ptyManager)
const automationDeliveryRouter = new AutomationDeliveryRouter(automationRunner)
composioWebhookService.setDeliveryHandler((payload) => automationDeliveryRouter.handleComposioPayload(payload))
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

/** Allow opening Linear hosts in the system browser from the renderer. */
function isAllowedShellOpenUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const host = u.hostname.toLowerCase()
    return (
      host === 'linear.app' ||
      host === 'www.linear.app' ||
      host === 'linear.new' ||
      host === 'www.linear.new'
    )
  } catch {
    return false
  }
}

/**
 * electron-vite dev can reload the main bundle without exiting the process. A second
 * `registerIpcHandlers()` call would throw on the first duplicate `ipcMain.handle`, so every
 * handler after that point (including Composio / ngrok) would stay unregistered while the
 * renderer still invokes those channels.
 */
function resetMainProcessIpcHandlers(): void {
  for (const channel of Object.values(IPC)) {
    ipcMain.removeHandler(channel)
  }
  const ipcOnChannels = [
    IPC.GIT_CLONE_REPO_CANCEL,
    IPC.GIT_SYNC_SET_BUSY,
    IPC.PTY_WRITE,
    IPC.PTY_SUGGEST_TAB_TITLE,
    IPC.PTY_RESIZE,
    IPC.PTY_DESTROY,
    IPC.FS_WATCH_STOP,
    IPC.AUTOMATION_WORKSPACE_EVENT,
    IPC.STATE_SAVE_SYNC,
  ] as const
  for (const ch of ipcOnChannels) {
    ipcMain.removeAllListeners(ch)
  }
}

export function registerIpcHandlers(): void {
  resetMainProcessIpcHandlers()

  // ── Git handlers ──
  ipcMain.handle(IPC.GIT_LIST_WORKTREES, async (_e, repoPath: string) => {
    return GitService.listWorktrees(repoPath)
  })

  ipcMain.handle(IPC.GIT_CHECK_IS_REPO, async (_e, dirPath: string) => {
    return GitService.isGitRepo(dirPath)
  })

  ipcMain.handle(IPC.GIT_GET_PROJECT_REPO_ANCHOR, async (_e, dirPath: string) => {
    return GitService.getProjectRepoAnchor(dirPath)
  })

  ipcMain.handle(IPC.GIT_IS_SECONDARY_WORKTREE_ROOT, async (_e, repoPath: string, workspaceRoot: string) => {
    return GitService.isSecondaryWorktreeRoot(repoPath, workspaceRoot)
  })

  ipcMain.handle(IPC.GIT_INIT_REPO, async (_e, dirPath: string) => {
    return GitService.initRepo(dirPath)
  })

  ipcMain.handle(IPC.GIT_CLONE_REPO, async (_e, opts: CloneRepoOptions): Promise<CloneRepoResult> => {
    if (!opts || typeof opts.url !== 'string' || typeof opts.destPath !== 'string' || typeof opts.requestId !== 'string') {
      throw new Error('Invalid clone request')
    }

    // Defense-in-depth: renderer validates with the same parser, but re-validate here before spawning git.
    if (parseGithubUrl(opts.url) === null && !opts.url.startsWith('file://')) {
      throw new Error(CLONE_ERROR_CODES.INVALID_URL)
    }

    // Pre-check destination before handing off to the cloner so we can surface a
    // clean, typed error that the renderer can convert into a dialog.
    if (existsSync(opts.destPath)) {
      const isRepo = await GitService.isGitRepo(opts.destPath)
      if (isRepo) {
        throw new Error(CLONE_ERROR_CODES.DEST_EXISTS_REPO)
      }
      // `cloneRepo` handles the non-empty case (see git-service.ts), but we fail fast here
      // to avoid the spawn cost when the target is known to be unusable.
    }

    return GitService.cloneRepo(opts, (progress) => {
      const payload: CloneRepoProgressEvent = { ...progress, requestId: opts.requestId }
      _e.sender.send(IPC.GIT_CLONE_REPO_PROGRESS, payload)
    })
  })

  ipcMain.on(IPC.GIT_CLONE_REPO_CANCEL, (_e, requestId: string) => {
    if (typeof requestId !== 'string' || requestId.length === 0) return
    GitService.cancelClone(requestId)
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

  ipcMain.handle(IPC.GIT_CREATE_WORKTREE_FROM_PR, async (_e, repoPath: string, name: string, prNumber: number, localBranch: string, force?: boolean, requestId?: string, credentialRules?: WorktreeCredentialRule[], options?: import('./git-service').CreatePrWorktreeOptions) => {
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
      options,
    )
  })

  ipcMain.handle(IPC.GIT_REMOVE_WORKTREE, async (_e, repoPath: string, worktreePath: string) => {
    return GitService.removeWorktree(repoPath, worktreePath)
  })

  ipcMain.handle(IPC.GIT_GET_STATUS, async (_e, worktreePath: string) => {
    return measureMainAsync('git:get-status', () => GitService.getStatus(worktreePath), {
      worktreePath,
    })
  })

  ipcMain.handle(IPC.GIT_GET_DIFF, async (_e, worktreePath: string, staged: boolean) => {
    return GitService.getDiff(worktreePath, staged)
  })

  ipcMain.handle(IPC.GIT_GET_WORKTREE_DIFF, async (_e, worktreePath: string) => {
    return measureMainAsync('git:get-worktree-diff', () => GitService.getWorkingTreeDiff(worktreePath), {
      worktreePath,
    })
  })

  ipcMain.handle(IPC.GIT_GET_FILE_DIFF, async (_e, worktreePath: string, filePath: string) => {
    return measureMainAsync('git:get-file-diff', () => GitService.getFileDiff(worktreePath, filePath), {
      worktreePath,
      filePath,
    })
  })

  ipcMain.handle(IPC.GIT_GET_BRANCHES, async (_e, repoPath: string) => {
    return GitService.getBranches(repoPath)
  })

  ipcMain.handle(IPC.GIT_STAGE, async (_e, worktreePath: string, paths: string[]) => {
    return GitService.stage(worktreePath, paths)
  })

  ipcMain.handle(IPC.GIT_STAGE_ALL, async (_e, worktreePath: string) => {
    return GitService.stageAll(worktreePath)
  })

  ipcMain.handle(IPC.GIT_UNSTAGE, async (_e, worktreePath: string, paths: string[]) => {
    return GitService.unstage(worktreePath, paths)
  })

  ipcMain.handle(IPC.GIT_DISCARD, async (_e, worktreePath: string, paths: string[], untracked: string[]) => {
    return GitService.discard(worktreePath, paths, untracked)
  })

  ipcMain.handle(IPC.GIT_APPLY_HUNK_ACTION, async (_e, worktreePath: string, request: GitHunkActionRequest) => {
    return GitService.applyHunkAction(worktreePath, request)
  })

  ipcMain.handle(IPC.GIT_COMMIT, async (_e, worktreePath: string, message: string) => {
    return GitService.commit(worktreePath, message)
  })

  ipcMain.handle(IPC.GIT_PUSH_CURRENT_BRANCH, async (_e, worktreePath: string) => {
    return GitService.pushCurrentBranch(worktreePath)
  })

  ipcMain.handle(IPC.GIT_PUSH_TO_PR_HEAD, async (_e, worktreePath: string, remote: string, headRefName: string) => {
    return GitService.pushToPrHead(worktreePath, remote, headRefName)
  })

  ipcMain.handle(IPC.GIT_FETCH_AND_REBASE, async (_e, worktreePath: string, remote: string, ref: string) => {
    try {
      await GitService.fetchAndRebase(worktreePath, remote, ref)
      return { ok: true as const }
    } catch (err) {
      if (err instanceof RebaseConflictError) {
        return { ok: false as const, kind: 'conflict' as const, files: err.conflictedFiles }
      }
      throw err
    }
  })

  ipcMain.handle(IPC.GIT_LIST_REBASE_CONFLICTS, async (_e, worktreePath: string) => {
    return GitService.listRebaseConflicts(worktreePath)
  })

  ipcMain.handle(IPC.GIT_IS_AHEAD_OF_REMOTE, async (_e, worktreePath: string, remote: string, ref: string) => {
    return GitService.isAheadOfRemote(worktreePath, remote, ref)
  })

  ipcMain.handle(IPC.GIT_CHECKOUT_BRANCH, async (_e, worktreePath: string, branch: string, createNew?: boolean) => {
    return GitService.checkoutBranch(worktreePath, branch, createNew === true)
  })

  ipcMain.handle(IPC.GIT_GET_CURRENT_BRANCH, async (_e, worktreePath: string) => {
    return measureMainAsync('git:get-current-branch', () => GitService.getCurrentBranch(worktreePath), {
      worktreePath,
    })
  })

  ipcMain.handle(IPC.GIT_GET_HEAD_HASH, async (_e, worktreePath: string) => {
    return GitService.getHeadHash(worktreePath)
  })

  ipcMain.handle(IPC.GIT_GET_DEFAULT_BRANCH, async (_e, repoPath: string) => {
    return GitService.getDefaultBranch(repoPath)
  })

  ipcMain.handle(IPC.GIT_SHOW_FILE_AT_HEAD, async (_e, worktreePath: string, filePath: string) => {
    return measureMainAsync('git:show-file-at-head', () => GitService.showFileAtHead(worktreePath, filePath), {
      worktreePath,
      filePath,
    })
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

  // ── Spotlight handlers (workspace → repo-root one-way sync) ──
  ipcMain.handle(
    IPC.SPOTLIGHT_ENABLE,
    async (
      _e,
      opts: { projectId: string; workspaceId: string; worktreePath: string; rootPath: string },
    ) => {
      if (
        !opts ||
        typeof opts.projectId !== 'string' ||
        typeof opts.workspaceId !== 'string' ||
        typeof opts.worktreePath !== 'string' ||
        typeof opts.rootPath !== 'string'
      ) {
        throw new Error('Invalid spotlight enable request')
      }
      return spotlightService.enable(opts)
    },
  )

  ipcMain.handle(IPC.SPOTLIGHT_DISABLE, async (_e, projectId: string) => {
    if (typeof projectId !== 'string') return
    await spotlightService.disable(projectId)
  })

  ipcMain.handle(IPC.SPOTLIGHT_GET_STATUS, async (_e, projectId?: string) => {
    return spotlightService.getStatus(typeof projectId === 'string' ? projectId : undefined)
  })

  // ── GitHub handlers ──
  ipcMain.handle(IPC.GITHUB_GET_PR_STATUSES, async (_e, repoPath: string, branches: string[]) => {
    return measureMainAsync('github:get-pr-statuses', () => GithubService.getPrStatuses(repoPath, branches), {
      repoPath,
      branchCount: branches.length,
    })
  })

  ipcMain.handle(IPC.GITHUB_GET_PR_STATUSES_BY_NUMBER, async (_e, repoPath: string, numbers: number[]) => {
    return measureMainAsync('github:get-pr-statuses-by-number', () => GithubService.getPrStatusesByNumber(repoPath, numbers), {
      repoPath,
      prCount: numbers.length,
    })
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

  ipcMain.handle(IPC.GITHUB_CLONE_SUGGESTIONS, async (_e, query: string) => {
    return typeof query === 'string' ? GithubService.listCloneRepoSuggestions(query) : []
  })

  // ── Graphite handlers ──
  ipcMain.handle(IPC.GRAPHITE_GET_STACK, async (_e, repoPath: string, worktreePath: string) => {
    return measureMainAsync('graphite:get-stack', () => GraphiteService.getStackInfo(repoPath, worktreePath), {
      repoPath,
      worktreePath,
    })
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

  ipcMain.handle(
    IPC.GRAPHITE_RUN_STACK_ACTION,
    async (
      _e,
      repoPath: string,
      worktreePath: string,
      action: GraphiteStackAction,
      commitMessage: string,
      defaultBranch: string,
      stackBranchName?: string | null,
    ) => {
      return GraphiteService.runStackAction(
        repoPath,
        worktreePath,
        action,
        commitMessage,
        defaultBranch,
        stackBranchName ?? undefined,
      )
    },
  )

  ipcMain.handle(IPC.GRAPHITE_GET_CREATE_OPTIONS, async (_e, repoPath: string) => {
    return GraphiteService.getCreateOptions(repoPath)
  })

  ipcMain.handle(IPC.GRAPHITE_SET_BRANCH_PARENT, async (_e, repoPath: string, branch: string, parent: string) => {
    return GraphiteService.setBranchParent(repoPath, branch, parent)
  })

  // ── PTY handlers ──
  ipcMain.handle(IPC.PTY_CREATE, async (_e, workingDir: string, shell?: string, extraEnv?: Record<string, string>, command?: string[]) => {
    const win = BrowserWindow.fromWebContents(_e.sender)
    if (!win) throw new Error('No window found')
    return ptyManager.create(workingDir, win.webContents, shell, command, undefined, extraEnv)
  })

  // Service tabs need a broadcast (not a per-PTY callback) — onExit is consumed by the renderer-side store.
  ptyManager.onPtyExit = (ptyId, exitCode, workspaceId) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) {
        win.webContents.send(IPC.PTY_EXIT, { ptyId, exitCode, workspaceId })
      }
    }
  }

  ipcMain.handle(IPC.PACKAGE_SCRIPTS_LIST, async (_e, workingDir: string) => {
    return readPackageScripts(workingDir)
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

  ipcMain.handle(IPC.PTY_SNAPSHOT, async (_e, ptyId: string) => {
    return ptyManager.snapshot(ptyId)
  })

  // ── File handlers ──
  ipcMain.handle(IPC.FS_GET_TREE, async (_e, dirPath: string) => {
    return FileService.getTree(dirPath)
  })

  ipcMain.handle(IPC.FS_GET_TREE_WITH_STATUS, async (_e, dirPath: string) => {
    return measureMainAsync('fs:get-tree-with-status', async () => {
      const basePath = await FileService.normalizeFsRoot(dirPath)
      const [tree, statuses, prefixFromGit] = await Promise.all([
        FileService.getTree(basePath),
        GitService.getStatus(basePath).catch(() => []),
        GitService.getPathPrefixFromRepoRoot(basePath).catch(() => ''),
      ])

      // git status --porcelain paths are repo-root-relative; strip git's cwd prefix to match tree paths.
      let prefix = prefixFromGit
      if (prefix === '.') prefix = ''

      // Build map: basePath-relative path (posix) → git status
      const statusMap = new Map<string, string>()
      for (const s of statuses) {
        let p = s.path
        // Handle renamed files: "old -> new" — use the new path
        if (p.includes(' -> ')) {
          p = p.split(' -> ')[1]
        }
        // Strip repo-root prefix to get basePath-relative path
        if (prefix && p.startsWith(prefix + '/')) {
          p = p.slice(prefix.length + 1)
        }
        statusMap.set(p, s.status)
      }

      // Attach gitStatus to nodes, propagate to parent dirs
      function annotate(nodes: FileNode[]): boolean {
        let hasStatus = false
        for (const node of nodes) {
          const rel = relative(basePath, node.path).replace(/\\/g, '/')

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
      return { rootPath: basePath, tree }
    }, {
      dirPath,
    })
  })

  ipcMain.handle(IPC.FS_QUICK_OPEN_SEARCH, async (_e, worktreePath: string, request: import('../shared/quick-open-types').QuickOpenSearchRequest) => {
    return FileService.quickOpenSearch(worktreePath, request)
  })

  ipcMain.handle(IPC.LINEAR_FFF_QUICK_OPEN, async (_e, request: LinearFffQuickOpenRequest) => {
    return LinearFffService.quickOpenSearch(request)
  })

  ipcMain.handle(IPC.FS_CODE_SEARCH, async (_e, worktreePath: string, request: import('../shared/code-search-types').CodeSearchRequest) => {
    return FileService.codeSearch(worktreePath, request)
  })

  ipcMain.handle(IPC.FS_SEARCH_AGENT_PLANS, async (_e, worktreePath: string | string[], request: import('../shared/agent-plan-path').AgentPlanSearchRequest) => {
    return FileService.searchAgentPlanMarkdowns(worktreePath, request)
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
          void FileService.refreshQuickOpenSearch(dirPath)
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

  ipcMain.handle(IPC.APP_GENERATE_COMMIT_MESSAGE, async (_e, worktreePath: string) => {
    const model = readPersistedPiCommitMessageModel()
    return CommitMessageService.generateWithPi(worktreePath, model ? { model } : undefined)
  })

  ipcMain.handle(
    IPC.APP_GENERATE_LINEAR_ISSUE_DRAFT,
    async (
      _e,
      payload: {
        projectName: string
        worktreePath: string | null
        projectDescription?: string | null
        projectContentMarkdown?: string | null
        existingTitle?: string | null
        existingDescription?: string | null
      },
    ) => {
      return LinearDraftService.generateIssueDraft(payload)
    },
  )

  ipcMain.handle(
    IPC.APP_GENERATE_LINEAR_UPDATE_DRAFT,
    async (
      _e,
      payload: {
        projectName: string
        pastUpdates: string[]
        worktreePath: string | null
        projectDescription?: string | null
        projectContentMarkdown?: string | null
      },
    ) => {
      return LinearDraftService.generateProjectUpdateDraft(payload)
    },
  )

  ipcMain.handle(IPC.APP_RELAUNCH, () => {
    requestAppRelaunch({ relaunch: () => app.relaunch(), quit: () => app.quit() })
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

  const codexUsageService = new CodexUsageService()
  const cursorUsageService = new CursorUsageService()
  ipcMain.handle(IPC.CODEX_GET_RATE_LIMITS, async () => codexUsageService.getRateLimits())
  ipcMain.handle(IPC.CURSOR_GET_RATE_LIMITS, async () => cursorUsageService.getRateLimits())

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

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, async (_e, url: string) => {
    if (typeof url !== 'string' || !isAllowedShellOpenUrl(url)) {
      throw new Error('URL not allowed for openExternal')
    }
    await shell.openExternal(url)
  })

  const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'
  ipcMain.handle(
    IPC.LINEAR_GRAPHQL_REQUEST,
    async (_e, apiKey: string, query: string, variables?: Record<string, unknown>) => {
      const key = typeof apiKey === 'string' ? apiKey.trim() : ''
      if (!key) {
        return { errors: [{ message: 'Missing Linear API key.' }] }
      }
      if (typeof query !== 'string' || !query.trim()) {
        return { errors: [{ message: 'Missing GraphQL query.' }] }
      }
      try {
        const res = await fetch(LINEAR_GRAPHQL_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: key,
          },
          body: JSON.stringify({ query, variables: variables ?? undefined }),
        })
        const text = await res.text()
        let parsed: { data?: unknown; errors?: { message: string }[] }
        try {
          parsed = text ? (JSON.parse(text) as { data?: unknown; errors?: { message: string }[] }) : {}
        } catch {
          return {
            errors: [{ message: res.ok ? 'Invalid JSON from Linear' : `Linear HTTP ${res.status}` }],
          }
        }
        if (!res.ok) {
          return {
            errors: parsed.errors?.length
              ? parsed.errors
              : [{ message: `Linear HTTP ${res.status}` }],
          }
        }
        return parsed
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Network error'
        return { errors: [{ message: msg }] }
      }
    },
  )

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
    composioWebhookService.applyFromPersistedState(data)
    applyConductorAuthFromPersistedState(data)
    applyConductorSettingsFromPersistedState(data)
  })

  // Synchronous save for beforeunload — guarantees state is written before window closes
  ipcMain.on(IPC.STATE_SAVE_SYNC, (event, data: unknown) => {
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(stateFilePath(), JSON.stringify(data, null, 2), 'utf-8')
      composioWebhookService.applyFromPersistedState(data)
      applyConductorAuthFromPersistedState(data)
      applyConductorSettingsFromPersistedState(data)
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

  const getComposioWebhookStatus = () => {
    const st = composioWebhookService.getStatus()
    const settings = composioWebhookService.getSettings()
    const pathNorm = settings.path.startsWith('/') ? settings.path : `/${settings.path}`
    const base = (settings.publicBaseUrl || `http://127.0.0.1:${st.port || settings.port}`).replace(/\/+$/, '')
    const callbackUrl = `${base}${pathNorm}`
    return { ...st, callbackUrl, settings: { ...settings } }
  }

  ipcMain.handle(IPC.COMPOSIO_WEBHOOK_STATUS, async () => getComposioWebhookStatus())

  ipcMain.handle(IPC.COMPOSIO_WEBHOOK_APPLY_SETTINGS, async (_e, settings: ComposioWebhookSettings) => {
    await composioWebhookService.applySettings(settings)
    return getComposioWebhookStatus()
  })

  ipcMain.handle(IPC.COMPOSIO_SUGGEST_GITHUB_CONNECTED_ACCOUNT, async () => {
    const key = composioWebhookService.getSettings().apiKey.trim()
    const connectedAccountId = await composioSuggestGithubConnectedAccountId(key)
    return { connectedAccountId }
  })

  ipcMain.handle(IPC.COMPOSIO_SUBSCRIBE_WEBHOOK, async (_e, input?: { publicBaseUrl?: string }) => {
    const settings = composioWebhookService.getSettings()
    const st = composioWebhookService.getStatus()
    const pathNorm = settings.path.startsWith('/') ? settings.path : `/${settings.path}`
    const publicBaseUrl = typeof input?.publicBaseUrl === 'string' ? input.publicBaseUrl.trim().replace(/\/+$/, '') : settings.publicBaseUrl
    const base = (publicBaseUrl || `http://127.0.0.1:${st.port || settings.port}`).replace(/\/+$/, '')
    let registerUrl = `${base}${pathNorm}`
    const sec = settings.sharedSecret.trim()
    if (sec) {
      const u = new URL(registerUrl)
      u.searchParams.set('secret', sec)
      registerUrl = u.toString()
    }
    if (!publicBaseUrl.trim()) {
      throw new Error(
        'Set Public base URL to your HTTPS tunnel (e.g. ngrok) so Composio can reach this machine. Then click Register again.',
      )
    }
    const key = settings.apiKey.trim()
    try {
      return await composioSubscribeTriggerWebhookWithKeyFallback(key, registerUrl)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('10401')) {
        throw new Error(
          `${msg}\n\n` +
            `Connected toolkits (Gmail, GitHub, etc.) use OAuth; registering a webhook uses your Composio User API key (\`uak_…\`). A 401 means that key was rejected (expired, revoked, or wrong account). Run \`composio login\` so ~/.composio/user_data.json is fresh, or set COMPOSIO_API_KEY, then try Register again.`,
        )
      }
      throw e
    }
  })

  ipcMain.handle(IPC.COMPOSIO_NGROK_STATUS, async () => composioNgrokService.getStatus())

  ipcMain.handle(IPC.COMPOSIO_NGROK_START, async (_e, localPort: number) => {
    return composioNgrokService.start(localPort)
  })

  ipcMain.handle(IPC.COMPOSIO_NGROK_STOP, async () => composioNgrokService.stop())

  ipcMain.handle(
    IPC.COMPOSIO_UPSERT_TRIGGER,
    async (
      _e,
      input: {
        slug: string
        connectedAccountId: string
        triggerConfig: Record<string, unknown>
        apiKey?: string
      },
    ) => {
      const key = input.apiKey?.trim() || composioWebhookService.getSettings().apiKey.trim()
      try {
        return await composioTriggerUpsertWithCliFallback({
          apiKey: key,
          slug: input.slug,
          connectedAccountId: input.connectedAccountId,
          triggerConfig: input.triggerConfig,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('10401')) {
          throw new Error(
            `${msg}\n\n` +
              `Connected toolkits use OAuth; trigger upsert needs a valid Composio User API key (\`uak_…\`). A 401 means that key was rejected. Run \`composio login\` or set COMPOSIO_API_KEY. ` +
              `Dashboard "project" keys differ from CLI login unless you use the same \`uak_…\` value.`,
          )
        }
        if (
          msg.includes('404') &&
          (msg.includes('Connected account') || msg.includes('ConnectedAccount') || msg.includes('"code":606'))
        ) {
          throw new Error(
            `${msg}\n\n` +
              `connectedAccountId must belong to the same Composio user as your API key. From the repo where you ran \`composio dev init\`, run:\n` +
              `  composio dev connected-accounts list --toolkits github\n` +
              `Copy an ACTIVE account's \`id\` (e.g. ca_…) into your JSON draft. If you switched between dashboard keys and CLI (\`uak_…\`) keys, list again — ids are scoped to that identity.`,
          )
        }
        throw e
      }
    },
  )

  ipcMain.handle(IPC.COMPOSIO_PARSE_PI_DRAFT, async (_e, jsonText: string) => {
    let raw: unknown
    try {
      raw = JSON.parse(typeof jsonText === 'string' ? jsonText : '')
    } catch {
      throw new Error('Invalid JSON')
    }
    return parseComposioPiAutomationDraft(raw)
  })

  ipcMain.handle(IPC.COMPOSIO_LIST_AUTOMATION_DEFINITIONS, async (_e, repoPaths?: string[]) => {
    return listComposioAutomationDefinitions(Array.isArray(repoPaths) ? repoPaths : undefined)
  })

  ipcMain.handle(
    IPC.COMPOSIO_SET_AUTOMATION_DEFINITION_ENABLED,
    async (_e, input: { repoPath: string; id: string; enabled: boolean }) => {
      if (!input || typeof input.repoPath !== 'string' || typeof input.id !== 'string') {
        throw new Error('Invalid Composio automation toggle request')
      }
      return setComposioAutomationDefinitionEnabled({
        repoPath: input.repoPath,
        id: input.id,
        enabled: Boolean(input.enabled),
      })
    },
  )

  ipcMain.handle(
    IPC.COMPOSIO_SET_AUTOMATION_DEFINITION_INSTRUCTIONS,
    async (_e, input: { repoPath: string; id: string; instructions: string }) => {
      if (!input || typeof input.repoPath !== 'string' || typeof input.id !== 'string') {
        throw new Error('Invalid Composio automation prompt update request')
      }
      if (typeof input.instructions !== 'string') {
        throw new Error('Invalid instructions value')
      }
      return setComposioAutomationDefinitionInstructions({
        repoPath: input.repoPath,
        id: input.id,
        instructions: input.instructions,
      })
    },
  )

  ipcMain.handle(
    IPC.COMPOSIO_SET_AUTOMATION_DEFINITION_AGENT,
    async (_e, input: { repoPath: string; id: string; agent: unknown }) => {
      if (!input || typeof input.repoPath !== 'string' || typeof input.id !== 'string') {
        throw new Error('Invalid Composio automation agent update request')
      }
      if (!isComposioAutomationAgent(input.agent)) {
        throw new Error('Invalid agent value')
      }
      return setComposioAutomationDefinitionAgent({
        repoPath: input.repoPath,
        id: input.id,
        agent: input.agent,
      })
    },
  )

  // ── Track 6: terminal scrollback persistence ──
  // Per-tab scrollback survives app quit so users can scroll up after reopen.
  // Capped per-file to bound disk usage; sanitized key prevents path traversal.
  const SCROLLBACK_DIR = () => join(app.getPath('userData'), 'scrollback')
  const SCROLLBACK_MAX_BYTES = 2 * 1024 * 1024 // 2 MB — matches plan budget
  const sanitizeScrollbackKey = (key: unknown): string | null => {
    if (typeof key !== 'string') return null
    // Defence-in-depth: only allow characters used in UUIDs / pty ids / hex.
    if (!/^[A-Za-z0-9._-]+$/.test(key)) return null
    if (key === '.' || key === '..' || key.length === 0 || key.length > 200) return null
    return key
  }
  const scrollbackPathFor = (key: string) => join(SCROLLBACK_DIR(), `${key}.txt`)

  ipcMain.handle(IPC.PTY_SCROLLBACK_LOAD, async (_e, key: unknown) => {
    const sanitized = sanitizeScrollbackKey(key)
    if (!sanitized) return ''
    try {
      const { readFile } = await import('fs/promises')
      return await readFile(scrollbackPathFor(sanitized), 'utf-8')
    } catch {
      return ''
    }
  })

  ipcMain.handle(IPC.PTY_SCROLLBACK_SAVE, async (_e, key: unknown, text: unknown) => {
    const sanitized = sanitizeScrollbackKey(key)
    if (!sanitized || typeof text !== 'string') return false
    try {
      await mkdir(SCROLLBACK_DIR(), { recursive: true })
      // If the buffer overshoots the cap, drop the oldest bytes (keep tail) so
      // the user always sees their most-recent terminal output on reopen.
      const trimmed = text.length > SCROLLBACK_MAX_BYTES
        ? text.slice(text.length - SCROLLBACK_MAX_BYTES)
        : text
      await writeFile(scrollbackPathFor(sanitized), trimmed, 'utf-8')
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(IPC.PTY_SCROLLBACK_DELETE, async (_e, key: unknown) => {
    const sanitized = sanitizeScrollbackKey(key)
    if (!sanitized) return false
    try {
      const { unlink } = await import('fs/promises')
      await unlink(scrollbackPathFor(sanitized))
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(IPC.PROJECT_STARTUP_SETTINGS_LOAD_ALL, async () => {
    return await listProjectStartupSettings()
  })

  ipcMain.handle(IPC.PROJECT_STARTUP_SETTINGS_GET, async (_e, repoPath: string) => {
    return await getProjectStartupCommands(repoPath)
  })

  ipcMain.handle(IPC.PROJECT_STARTUP_SETTINGS_SET, async (_e, repoPath: string, startupCommands: unknown) => {
    return await setProjectStartupCommands(repoPath, startupCommands)
  })

  ipcMain.handle(IPC.PROJECT_STARTUP_SETTINGS_DELETE, async (_e, repoPath: string) => {
    await deleteProjectStartupCommands(repoPath)
  })

  ipcMain.handle(IPC.PROJECT_STARTUP_SETTINGS_PATH, async () => {
    return getProjectStartupSettingsPath()
  })

  // ── Pi SDK (in-process) ──
  const piHost = getConstellPiHost()
  ipcMain.handle(IPC.PI_GET_STATE, async () => piHost.getState())
  ipcMain.handle(IPC.PI_GET_SELECTED_TRANSCRIPT, async () => piHost.getSelectedTranscript())
  ipcMain.handle(IPC.PI_SYNC_WORKSPACE, async (_e, workspacePath: string, displayName?: string) =>
    piHost.syncWorkspace(workspacePath, displayName),
  )
  ipcMain.handle(
    IPC.PI_SELECT_SESSION,
    async (_e, target: { workspaceId: string; sessionId: string }) => piHost.selectSession(target),
  )
  ipcMain.handle(
    IPC.PI_CREATE_SESSION,
    async (_e, input: { workspaceId: string; title?: string }) => piHost.createSession(input),
  )
  ipcMain.handle(IPC.PI_SUBMIT_COMPOSER, async (_e, text: string) => piHost.submitComposer(text))
  ipcMain.handle(IPC.PI_UPDATE_COMPOSER_DRAFT, async (_e, draft: string) => piHost.updateComposerDraft(draft))
  ipcMain.handle(IPC.PI_CANCEL_CURRENT_RUN, async () => piHost.cancelCurrentRun())
  ipcMain.handle(IPC.PI_SET_COMPOSER_ATTACHMENTS, async (_e, attachments: ComposerAttachment[]) =>
    piHost.setComposerAttachments(attachments),
  )
  ipcMain.handle(IPC.PI_REMOVE_COMPOSER_ATTACHMENT, async (_e, attachmentId: string) =>
    piHost.removeComposerAttachment(attachmentId),
  )
  ipcMain.handle(
    IPC.PI_SET_SESSION_MODEL,
    async (_e, selection: { provider: string; modelId: string }) => piHost.setSessionModel(selection),
  )
  ipcMain.handle(IPC.PI_SET_SESSION_THINKING_LEVEL, async (_e, level: string) =>
    piHost.setSessionThinkingLevel(level),
  )
  ipcMain.handle(
    IPC.PI_CONTEXT_USAGE,
    async (_e, target: { workspaceId: string; sessionId: string }) => {
      const ws = typeof target?.workspaceId === 'string' ? target.workspaceId : ''
      const sid = typeof target?.sessionId === 'string' ? target.sessionId : ''
      if (!ws || !sid) return null
      return piHost.getContextUsageSnapshot({ workspaceId: ws, sessionId: sid })
    },
  )
  ipcMain.handle(IPC.PI_RESPOND_HOST_UI, async (_e, response: HostUiResponse) => piHost.respondToHostUi(response))
  ipcMain.handle(IPC.PI_EXTENSION_TUI_INPUT, async (_e, data: string) => piHost.sendExtensionTuiInput(data))

  // ── Conductor agent chat (Codex + Cursor) ──
  const agentChatHost = getAgentChatHost()
  ipcMain.handle(IPC.AGENT_CHAT_CREATE_SESSION, async (_e, input: CreateAgentChatSessionInput) =>
    agentChatHost.createSession(input),
  )
  ipcMain.handle(IPC.AGENT_CHAT_FORK_SESSION, async (_e, input: ForkAgentChatSessionInput) =>
    agentChatHost.forkSession(input),
  )
  ipcMain.handle(IPC.AGENT_CHAT_LIST_SESSIONS, async (_e, workspaceId: string) =>
    agentChatHost.listSessions(workspaceId),
  )
  ipcMain.handle(IPC.AGENT_CHAT_GET_SESSION, async (_e, sessionId: string) =>
    agentChatHost.getSession(sessionId),
  )
  ipcMain.handle(IPC.AGENT_CHAT_GET_CONTEXT_USAGE, async (_e, sessionId: string) =>
    agentChatHost.getContextUsage(sessionId),
  )
  ipcMain.handle(
    IPC.AGENT_CHAT_SUBMIT,
    async (
      _e,
      sessionId: string,
      text: string,
      deliverAs?: import('../shared/agent-chat-types').QueuedAgentMessageMode,
      attachments?: readonly import('../shared/conductor-attachments').ConductorComposerAttachment[],
    ) => agentChatHost.submit(sessionId, text, deliverAs, attachments),
  )
  ipcMain.handle(IPC.AGENT_CHAT_PICK_IMAGES, async () => {
    const { pickConductorImageAttachments } = await import('./conductor-image-picker')
    return pickConductorImageAttachments()
  })
  ipcMain.handle(
    IPC.AGENT_CHAT_REPLACE_QUEUE,
    async (_e, sessionId: string, messages: import('../shared/agent-chat-types').QueuedAgentMessage[]) =>
      agentChatHost.replaceQueue(sessionId, messages),
  )
  ipcMain.handle(IPC.AGENT_CHAT_SET_MODEL, async (_e, sessionId: string, model: string) =>
    agentChatHost.setModel(sessionId, model),
  )
  ipcMain.handle(IPC.AGENT_CHAT_SET_PLAN, async (_e, sessionId: string, plan: boolean) =>
    agentChatHost.setPlan(sessionId, plan),
  )
  ipcMain.handle(
    IPC.AGENT_CHAT_SET_THINKING_LEVEL,
    async (_e, sessionId: string, thinkingLevel: import('../shared/conductor-thinking').ThinkingLevel) =>
      agentChatHost.setThinkingLevel(sessionId, thinkingLevel),
  )
  ipcMain.handle(IPC.AGENT_CHAT_CANCEL, async (_e, sessionId: string) => {
    if (process.env.CI_TEST === '1' || process.env.CI_TEST === 'true') {
      ;(globalThis as { __agentChatCancelCount?: number }).__agentChatCancelCount =
        ((globalThis as { __agentChatCancelCount?: number }).__agentChatCancelCount ?? 0) + 1
    }
    return agentChatHost.cancel(sessionId)
  })
  ipcMain.handle(
    IPC.AGENT_CHAT_RESPOND_BLOCKING_QUESTION,
    async (
      _e,
      sessionId: string,
      response: import('../shared/conductor-ask-question-types').ConductorBlockingQuestionResponse,
    ) => agentChatHost.respondBlockingQuestion(sessionId, response),
  )
  ipcMain.handle(IPC.AGENT_CHAT_DELETE_SESSION, async (_e, sessionId: string) =>
    agentChatHost.deleteSession(sessionId),
  )
  ipcMain.handle(IPC.AGENT_CHAT_GET_AUTH_STATUS, async (_e, force?: boolean) =>
    getConductorAuthStatus(Boolean(force)),
  )
  ipcMain.handle(
    IPC.CONDUCTOR_AUTH_SYNC,
    async (_e, input: { cursorApiKey?: string; openaiApiKey?: string; codexWebSockets?: CodexWebSocketsSetting }) => {
      setConductorAuthKeys(input?.cursorApiKey ?? '', input?.openaiApiKey ?? '')
      setConductorCodexWebSocketsSetting(input?.codexWebSockets)
    },
  )
}

export function getGithubPollService(): GithubPollService {
  return githubPollService
}

/** Kill all PTY processes and stop all automation jobs. Call on app quit. */
export function getSpotlightService(): SpotlightService {
  return spotlightService
}

export function cleanupAll(): void {
  worktreeSyncService.stopAll()
  spotlightService.stopAll()
  ptyManager.destroyAll()
  automationEngine.destroyAll()
  githubPollService.stop()
  composioNgrokService.stop()
  void composioWebhookService.stop()
  lspService.shutdown()
  AnnotationService.cleanupAll()
  FileService.disposeQuickOpenSearch()
  LinearFffService.disposeAll()
  getAgentChatHost().dispose()
  guestTabSwitchListeners.clear()
  closeAllAgentFS().catch(() => {})
}
