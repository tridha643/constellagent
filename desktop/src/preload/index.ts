import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  AutomationConfig,
  AutomationConfigLike,
  AutomationRunStartedEvent,
  AutomationStatusEvent,
  AutomationWorkspaceEvent,
} from '../shared/automation-types'
import type { CreateWorktreeProgressEvent } from '../shared/workspace-creation'
import type { SyncProgress, SyncResult } from '../shared/sync-types'
import type { PlanAgent } from '../shared/agent-plan-path'
import type { PiModelOption } from '../shared/plan-build-command'
import type { WorktreeSyncEvent } from '../shared/worktree-sync-types'
import type { GraphiteCreateOptions, GraphiteStackAction, GraphiteStackActionResult, GraphiteStackInfo } from '../shared/graphite-types'
import type { ReviewComment } from '../shared/review-types'
import type { ContextWindowData } from '../shared/context-window-types'
import type { WorktreeCredentialRule } from '../shared/worktree-credentials'

const api = {
  git: {
    listWorktrees: (repoPath: string) =>
      ipcRenderer.invoke(IPC.GIT_LIST_WORKTREES, repoPath),
    checkIsRepo: (dirPath: string) =>
      ipcRenderer.invoke(IPC.GIT_CHECK_IS_REPO, dirPath) as Promise<boolean>,
    getProjectRepoAnchor: (dirPath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_PROJECT_REPO_ANCHOR, dirPath) as Promise<string>,
    isSecondaryWorktreeRoot: (repoPath: string, workspaceRoot: string) =>
      ipcRenderer.invoke(IPC.GIT_IS_SECONDARY_WORKTREE_ROOT, repoPath, workspaceRoot) as Promise<boolean>,
    initRepo: (dirPath: string) =>
      ipcRenderer.invoke(IPC.GIT_INIT_REPO, dirPath) as Promise<void>,
    createWorktree: (repoPath: string, name: string, branch: string, newBranch: boolean, baseBranch?: string, force?: boolean, requestId?: string, credentialRules?: WorktreeCredentialRule[]) =>
      ipcRenderer.invoke(IPC.GIT_CREATE_WORKTREE, repoPath, name, branch, newBranch, baseBranch, force, requestId, credentialRules),
    createWorktreeFromPr: (repoPath: string, name: string, prNumber: number, localBranch: string, force?: boolean, requestId?: string, credentialRules?: WorktreeCredentialRule[]) =>
      ipcRenderer.invoke(IPC.GIT_CREATE_WORKTREE_FROM_PR, repoPath, name, prNumber, localBranch, force, requestId, credentialRules) as Promise<{ worktreePath: string; branch: string }>,
    onCreateWorktreeProgress: (callback: (progress: CreateWorktreeProgressEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: CreateWorktreeProgressEvent) => callback(progress)
      ipcRenderer.on(IPC.GIT_CREATE_WORKTREE_PROGRESS, listener)
      return () => {
        ipcRenderer.removeListener(IPC.GIT_CREATE_WORKTREE_PROGRESS, listener)
      }
    },
    removeWorktree: (repoPath: string, worktreePath: string) =>
      ipcRenderer.invoke(IPC.GIT_REMOVE_WORKTREE, repoPath, worktreePath),
    getStatus: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_STATUS, worktreePath),
    getDiff: (worktreePath: string, staged: boolean) =>
      ipcRenderer.invoke(IPC.GIT_GET_DIFF, worktreePath, staged),
    getFileDiff: (worktreePath: string, filePath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_FILE_DIFF, worktreePath, filePath),
    getBranches: (repoPath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_BRANCHES, repoPath),
    stage: (worktreePath: string, paths: string[]) =>
      ipcRenderer.invoke(IPC.GIT_STAGE, worktreePath, paths),
    unstage: (worktreePath: string, paths: string[]) =>
      ipcRenderer.invoke(IPC.GIT_UNSTAGE, worktreePath, paths),
    discard: (worktreePath: string, paths: string[], untracked: string[]) =>
      ipcRenderer.invoke(IPC.GIT_DISCARD, worktreePath, paths, untracked),
    commit: (worktreePath: string, message: string) =>
      ipcRenderer.invoke(IPC.GIT_COMMIT, worktreePath, message),
    pushCurrentBranch: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.GIT_PUSH_CURRENT_BRANCH, worktreePath) as Promise<void>,
    getCurrentBranch: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_CURRENT_BRANCH, worktreePath) as Promise<string>,
    getHeadHash: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_HEAD_HASH, worktreePath) as Promise<string>,
    getDefaultBranch: (repoPath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_DEFAULT_BRANCH, repoPath) as Promise<string>,
    showFileAtHead: (worktreePath: string, filePath: string) =>
      ipcRenderer.invoke(IPC.GIT_SHOW_FILE_AT_HEAD, worktreePath, filePath) as Promise<string | null>,
    getLog: (worktreePath: string, maxCount?: number) =>
      ipcRenderer.invoke(IPC.GIT_GET_LOG, worktreePath, maxCount) as Promise<import('../shared/git-types').GitLogEntry[]>,
    getCommitDiff: (worktreePath: string, hash: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_COMMIT_DIFF, worktreePath, hash) as Promise<string>,
    getRemoteHead: (repoPath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_REMOTE_HEAD, repoPath) as Promise<string | null>,
    syncAllWorktrees: (projectId: string) => ipcRenderer.invoke(IPC.GIT_SYNC_ALL_WORKTREES, projectId),
    startSyncPolling: (projectId: string, repoPath: string) =>
      ipcRenderer.invoke(IPC.GIT_START_SYNC_POLLING, projectId, repoPath),
    stopSyncPolling: (projectId: string) => ipcRenderer.invoke(IPC.GIT_STOP_SYNC_POLLING, projectId),
    setSyncBusy: (worktreePaths: string[]) => ipcRenderer.send(IPC.GIT_SYNC_SET_BUSY, worktreePaths),
    onWorktreeSyncStatus: (callback: (status: WorktreeSyncEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: WorktreeSyncEvent) => callback(status)
      ipcRenderer.on(IPC.GIT_WORKTREE_SYNC_STATUS, listener)
      return () => {
        ipcRenderer.removeListener(IPC.GIT_WORKTREE_SYNC_STATUS, listener)
      }
    },
  },

  graphite: {
    getStack: (repoPath: string, worktreePath: string) =>
      ipcRenderer.invoke(IPC.GRAPHITE_GET_STACK, repoPath, worktreePath) as Promise<GraphiteStackInfo | null>,
    checkoutBranch: (worktreePath: string, branch: string) =>
      ipcRenderer.invoke(IPC.GRAPHITE_CHECKOUT_BRANCH, worktreePath, branch) as Promise<string>,
    cloneStack: (repoPath: string, name: string, prBranches: { name: string; parent: string | null }[], credentialRules?: WorktreeCredentialRule[]) =>
      ipcRenderer.invoke(IPC.GRAPHITE_CLONE_STACK, repoPath, name, prBranches, credentialRules) as Promise<{ worktreePath: string; branch: string }>,
    getStackForPr: (repoPath: string, prBranch: string) =>
      ipcRenderer.invoke(IPC.GRAPHITE_GET_STACK_FOR_PR, repoPath, prBranch) as Promise<{ name: string; parent: string | null }[] | null>,
    runStackAction: (
      repoPath: string,
      worktreePath: string,
      action: GraphiteStackAction,
      commitMessage: string,
      defaultBranch: string,
      stackBranchName?: string | null,
    ) =>
      ipcRenderer.invoke(
        IPC.GRAPHITE_RUN_STACK_ACTION,
        repoPath,
        worktreePath,
        action,
        commitMessage,
        defaultBranch,
        stackBranchName ?? null,
      ) as Promise<GraphiteStackActionResult>,
    getCreateOptions: (repoPath: string) =>
      ipcRenderer.invoke(IPC.GRAPHITE_GET_CREATE_OPTIONS, repoPath) as Promise<GraphiteCreateOptions | null>,
    setBranchParent: (repoPath: string, branch: string, parent: string) =>
      ipcRenderer.invoke(IPC.GRAPHITE_SET_BRANCH_PARENT, repoPath, branch, parent) as Promise<void>,
  },

  pty: {
    create: (workingDir: string, shell?: string, extraEnv?: Record<string, string>) =>
      ipcRenderer.invoke(IPC.PTY_CREATE, workingDir, shell, extraEnv),
    write: (ptyId: string, data: string, opts?: { submittedLine?: string }) =>
      ipcRenderer.send(IPC.PTY_WRITE, ptyId, data, opts),
    suggestTabTitle: (ptyId: string, line: string) =>
      ipcRenderer.send(IPC.PTY_SUGGEST_TAB_TITLE, ptyId, line),
    resize: (ptyId: string, cols: number, rows: number) =>
      ipcRenderer.send(IPC.PTY_RESIZE, ptyId, cols, rows),
    destroy: (ptyId: string) =>
      ipcRenderer.send(IPC.PTY_DESTROY, ptyId),
    list: () =>
      ipcRenderer.invoke(IPC.PTY_LIST) as Promise<string[]>,
    reattach: (ptyId: string) =>
      ipcRenderer.invoke(IPC.PTY_REATTACH, ptyId) as Promise<boolean>,
    onData: (ptyId: string, callback: (data: string) => void) => {
      const channel = `${IPC.PTY_DATA}:${ptyId}`
      const listener = (_event: Electron.IpcRendererEvent, data: string) => callback(data)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
    onTitleChanged: (callback: (data: { ptyId: string; title: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { ptyId: string; title: string }) => callback(data)
      ipcRenderer.on(IPC.PTY_TITLE_CHANGED, listener)
      return () => {
        ipcRenderer.removeListener(IPC.PTY_TITLE_CHANGED, listener)
      }
    },
    onAgentDetected: (callback: (data: { ptyId: string; agentType: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { ptyId: string; agentType: string }) => callback(data)
      ipcRenderer.on(IPC.PTY_AGENT_DETECTED, listener)
      return () => {
        ipcRenderer.removeListener(IPC.PTY_AGENT_DETECTED, listener)
      }
    },
  },

  fs: {
    getTree: (dirPath: string) =>
      ipcRenderer.invoke(IPC.FS_GET_TREE, dirPath),
    getTreeWithStatus: (dirPath: string) =>
      ipcRenderer.invoke(IPC.FS_GET_TREE_WITH_STATUS, dirPath),
    readFile: (filePath: string) =>
      ipcRenderer.invoke(IPC.FS_READ_FILE, filePath),
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke(IPC.FS_WRITE_FILE, filePath, content),
    deleteFile: (filePath: string) =>
      ipcRenderer.invoke(IPC.FS_DELETE_FILE, filePath),
    watchDir: (dirPath: string) =>
      ipcRenderer.invoke(IPC.FS_WATCH_START, dirPath),
    unwatchDir: (dirPath: string) =>
      ipcRenderer.send(IPC.FS_WATCH_STOP, dirPath),
    onDirChanged: (callback: (dirPath: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, dirPath: string) => callback(dirPath)
      ipcRenderer.on(IPC.FS_WATCH_CHANGED, listener)
      return () => {
        ipcRenderer.removeListener(IPC.FS_WATCH_CHANGED, listener)
      }
    },
    findNewestPlanMarkdown: (worktreePath: string | string[]) =>
      ipcRenderer.invoke(IPC.FS_FIND_NEWEST_PLAN, worktreePath) as Promise<string | null>,
    listAgentPlanMarkdowns: (worktreePath: string | string[]) =>
      ipcRenderer.invoke(IPC.FS_LIST_AGENT_PLANS, worktreePath) as Promise<
        { path: string; mtimeMs: number; agent: string; built?: boolean; codingAgent?: string | null; planSourceRoot?: string }[]
      >,
    readPlanMeta: (filePath: string) =>
      ipcRenderer.invoke(IPC.FS_READ_PLAN_META, filePath) as Promise<{ built: boolean; codingAgent: string | null; buildHarness: PlanAgent | null }>,
    updatePlanMeta: (filePath: string, patch: { built?: boolean; codingAgent?: string | null; buildHarness?: PlanAgent | null }) =>
      ipcRenderer.invoke(IPC.FS_UPDATE_PLAN_META, filePath, patch) as Promise<{ built: boolean; codingAgent: string | null; buildHarness: PlanAgent | null }>,
    relocateAgentPlan: (worktreePath: string, filePath: string, targetAgent: string, mode: 'copy' | 'move') =>
      ipcRenderer.invoke(IPC.FS_RELOCATE_AGENT_PLAN, worktreePath, filePath, targetAgent, mode) as Promise<string>,
  },

  app: {
    getHomeDir: () => ipcRenderer.invoke(IPC.APP_GET_HOME_DIR) as Promise<string>,
    listPiModels: () => ipcRenderer.invoke(IPC.APP_LIST_PI_MODELS) as Promise<PiModelOption[]>,
    generateCommitMessage: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.APP_GENERATE_COMMIT_MESSAGE, worktreePath) as Promise<string>,
    selectDirectory: () =>
      ipcRenderer.invoke(IPC.APP_SELECT_DIRECTORY),
    selectFile: (filters?: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke(IPC.APP_SELECT_FILE, filters) as Promise<string | null>,
    addProjectPath: (dirPath: string) =>
      ipcRenderer.invoke(IPC.APP_ADD_PROJECT_PATH, dirPath),
    openInEditor: (dirPath: string, cliCommand: string, extraArgs?: string[], openMode?: string) =>
      ipcRenderer.invoke(IPC.APP_OPEN_IN_EDITOR, dirPath, cliCommand, extraArgs, openMode) as Promise<{ success: boolean; error?: string }>,
    relaunch: () => ipcRenderer.invoke(IPC.APP_RELAUNCH) as Promise<void>,
  },

  skills: {
    scan: (skillPath: string) =>
      ipcRenderer.invoke(IPC.SKILLS_SCAN, skillPath) as Promise<{ name: string; description: string } | null>,
    sync: (skillPath: string, projectPath: string) =>
      ipcRenderer.invoke(IPC.SKILLS_SYNC, skillPath, projectPath),
    remove: (skillName: string, projectPath: string) =>
      ipcRenderer.invoke(IPC.SKILLS_REMOVE, skillName, projectPath),
    kvSave: (projectPath: string, skill: { name: string; description: string; sourcePath: string; enabled: boolean }) =>
      ipcRenderer.invoke(IPC.SKILLS_KV_SAVE, projectPath, skill),
    kvRemove: (projectPath: string, skillName: string) =>
      ipcRenderer.invoke(IPC.SKILLS_KV_REMOVE, projectPath, skillName),
    kvList: (projectPath: string) =>
      ipcRenderer.invoke(IPC.SKILLS_KV_LIST, projectPath) as Promise<Array<{ name: string; description: string; sourcePath: string; enabled: boolean }>>,
  },

  subagents: {
    scan: (filePath: string) =>
      ipcRenderer.invoke(IPC.SUBAGENTS_SCAN, filePath) as Promise<{ name: string; description: string; tools?: string } | null>,
    sync: (subagentPath: string, projectPath: string) =>
      ipcRenderer.invoke(IPC.SUBAGENTS_SYNC, subagentPath, projectPath),
    remove: (subagentName: string, projectPath: string) =>
      ipcRenderer.invoke(IPC.SUBAGENTS_REMOVE, subagentName, projectPath),
    kvSave: (projectPath: string, subagent: { name: string; description: string; sourcePath: string; tools?: string; enabled: boolean }) =>
      ipcRenderer.invoke(IPC.SUBAGENTS_KV_SAVE, projectPath, subagent),
    kvRemove: (projectPath: string, subagentName: string) =>
      ipcRenderer.invoke(IPC.SUBAGENTS_KV_REMOVE, projectPath, subagentName),
    kvList: (projectPath: string) =>
      ipcRenderer.invoke(IPC.SUBAGENTS_KV_LIST, projectPath) as Promise<Array<{ name: string; description: string; sourcePath: string; tools?: string; enabled: boolean }>>,
  },

  claude: {
    trustPath: (dirPath: string) =>
      ipcRenderer.invoke(IPC.CLAUDE_TRUST_PATH, dirPath),
    installHooks: () =>
      ipcRenderer.invoke(IPC.CLAUDE_INSTALL_HOOKS),
    uninstallHooks: () =>
      ipcRenderer.invoke(IPC.CLAUDE_UNINSTALL_HOOKS),
    checkHooks: () =>
      ipcRenderer.invoke(IPC.CLAUDE_CHECK_HOOKS),
    onNotifyWorkspace: (callback: (workspaceId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, wsId: string) => callback(wsId)
      ipcRenderer.on(IPC.CLAUDE_NOTIFY_WORKSPACE, listener)
      return () => {
        ipcRenderer.removeListener(IPC.CLAUDE_NOTIFY_WORKSPACE, listener)
      }
    },
    onActivityUpdate: (callback: (entries: { wsId: string; agentType: string }[]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, entries: { wsId: string; agentType: string }[]) => callback(entries)
      ipcRenderer.on(IPC.CLAUDE_ACTIVITY_UPDATE, listener)
      return () => {
        ipcRenderer.removeListener(IPC.CLAUDE_ACTIVITY_UPDATE, listener)
      }
    },
    getContextWindow: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.CLAUDE_CONTEXT_WINDOW, worktreePath) as Promise<ContextWindowData | null>,
  },

  codex: {
    installNotify: () =>
      ipcRenderer.invoke(IPC.CODEX_INSTALL_NOTIFY),
    uninstallNotify: () =>
      ipcRenderer.invoke(IPC.CODEX_UNINSTALL_NOTIFY),
    checkNotify: () =>
      ipcRenderer.invoke(IPC.CODEX_CHECK_NOTIFY),
  },

  automations: {
    create: (automation: AutomationConfigLike) =>
      ipcRenderer.invoke(IPC.AUTOMATION_CREATE, automation),
    update: (automation: AutomationConfigLike) =>
      ipcRenderer.invoke(IPC.AUTOMATION_UPDATE, automation),
    delete: (automationId: string) =>
      ipcRenderer.invoke(IPC.AUTOMATION_DELETE, automationId),
    runNow: (automation: AutomationConfigLike) =>
      ipcRenderer.invoke(IPC.AUTOMATION_RUN_NOW, automation),
    stop: (automationId: string) =>
      ipcRenderer.invoke(IPC.AUTOMATION_STOP, automationId),
    emitWorkspaceEvent: (payload: AutomationWorkspaceEvent) =>
      ipcRenderer.send(IPC.AUTOMATION_WORKSPACE_EVENT, payload),
    onRunStarted: (callback: (data: AutomationRunStartedEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: AutomationRunStartedEvent) => callback(data)
      ipcRenderer.on(IPC.AUTOMATION_RUN_STARTED, listener)
      return () => {
        ipcRenderer.removeListener(IPC.AUTOMATION_RUN_STARTED, listener)
      }
    },
    onStatusUpdated: (callback: (data: AutomationStatusEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: AutomationStatusEvent) => callback(data)
      ipcRenderer.on(IPC.AUTOMATION_STATUS_UPDATED, listener)
      return () => {
        ipcRenderer.removeListener(IPC.AUTOMATION_STATUS_UPDATED, listener)
      }
    },
  },

  github: {
    getPrStatuses: (repoPath: string, branches: string[]) =>
      ipcRenderer.invoke(IPC.GITHUB_GET_PR_STATUSES, repoPath, branches),
    listOpenPrs: (repoPath: string) =>
      ipcRenderer.invoke(IPC.GITHUB_LIST_OPEN_PRS, repoPath),
    resolvePr: (repoPath: string, prNumber: number, repoSlug?: string) =>
      ipcRenderer.invoke(IPC.GITHUB_RESOLVE_PR, repoPath, prNumber, repoSlug) as Promise<{ branch: string; title: string; number: number }>,
    createPr: (repoPath: string, headBranch: string, baseBranch: string) =>
      ipcRenderer.invoke(IPC.GITHUB_CREATE_PR, repoPath, headBranch, baseBranch) as Promise<{ number: number; url: string }>,
    reopenPr: (repoPath: string, prNumber: number) =>
      ipcRenderer.invoke(IPC.GITHUB_REOPEN_PR, repoPath, prNumber) as Promise<{ number: number; url: string }>,
    getPrReviewComments: (repoPath: string, prNumber: number) =>
      ipcRenderer.invoke(IPC.GITHUB_GET_PR_REVIEW_COMMENTS, repoPath, prNumber) as Promise<import('../main/github-service').PrReviewComment[]>,
  },

  lsp: {
    getPort: () =>
      ipcRenderer.invoke(IPC.LSP_GET_PORT) as Promise<number>,
    getAvailableLanguages: () =>
      ipcRenderer.invoke(IPC.LSP_GET_AVAILABLE_LANGUAGES) as Promise<string[]>,
  },

  mcp: {
    loadServers: () =>
      ipcRenderer.invoke(IPC.MCP_LOAD_SERVERS) as Promise<import('../renderer/store/types').McpServer[]>,
    removeServer: (serverName: string) =>
      ipcRenderer.invoke(IPC.MCP_REMOVE_SERVER, serverName),
    getConfigPaths: () =>
      ipcRenderer.invoke(IPC.MCP_GET_CONFIG_PATHS) as Promise<Record<string, string>>,
  },

  session: {
    getLast: (workspaceId: string, agentType: string) =>
      ipcRenderer.invoke(IPC.SESSION_GET_LAST, workspaceId, agentType) as Promise<string | null>,
  },

  clipboard: {
    saveImage: () =>
      ipcRenderer.invoke(IPC.CLIPBOARD_SAVE_IMAGE) as Promise<string | null>,
  },

  review: {
    commentAdd: (worktreePath: string, file: string, newLine: number, summary: string, opts?: { rationale?: string; author?: string; focus?: boolean; oldLine?: number; force?: boolean; lineEnd?: number; workspaceId?: string }) =>
      ipcRenderer.invoke(IPC.REVIEW_COMMENT_ADD, worktreePath, file, newLine, summary, opts) as Promise<void>,
    commentList: (worktreePath: string, file?: string) =>
      ipcRenderer.invoke(IPC.REVIEW_COMMENT_LIST, worktreePath, file) as Promise<ReviewComment[]>,
    commentRemove: (worktreePath: string, commentId: string) =>
      ipcRenderer.invoke(IPC.REVIEW_COMMENT_REMOVE, worktreePath, commentId) as Promise<void>,
    commentClear: (worktreePath: string, file?: string) =>
      ipcRenderer.invoke(IPC.REVIEW_COMMENT_CLEAR, worktreePath, file) as Promise<void>,
    commentResolve: (worktreePath: string, commentId: string, resolved: boolean) =>
      ipcRenderer.invoke(IPC.REVIEW_COMMENT_RESOLVE, worktreePath, commentId, resolved) as Promise<void>,
    onAnnotationsCleared: (callback: (data: { repoPath: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { repoPath: string }) => callback(data)
      ipcRenderer.on(IPC.REVIEW_ANNOTATIONS_CLEARED, listener)
      return () => {
        ipcRenderer.removeListener(IPC.REVIEW_ANNOTATIONS_CLEARED, listener)
      }
    },
  },

  t3code: {
    start: (cwd: string) =>
      ipcRenderer.invoke(IPC.T3CODE_START, cwd) as Promise<string>,
    stop: (cwd: string) =>
      ipcRenderer.invoke(IPC.T3CODE_STOP, cwd),
  },

  webview: {
    registerTabSwitch: (guestWebContentsId: number) =>
      ipcRenderer.invoke(IPC.WEBVIEW_REGISTER_TAB_SWITCH, guestWebContentsId),
    unregisterTabSwitch: (guestWebContentsId: number) =>
      ipcRenderer.invoke(IPC.WEBVIEW_UNREGISTER_TAB_SWITCH, guestWebContentsId),
    onTabPrev: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on(IPC.WEBVIEW_TAB_PREV, listener)
      return () => { ipcRenderer.removeListener(IPC.WEBVIEW_TAB_PREV, listener) }
    },
    onTabNext: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on(IPC.WEBVIEW_TAB_NEXT, listener)
      return () => { ipcRenderer.removeListener(IPC.WEBVIEW_TAB_NEXT, listener) }
    },
  },

  state: {
    save: (data: unknown) =>
      ipcRenderer.invoke(IPC.STATE_SAVE, data),
    saveSync: (data: unknown) =>
      ipcRenderer.sendSync(IPC.STATE_SAVE_SYNC, data) as boolean,
    load: () =>
      ipcRenderer.invoke(IPC.STATE_LOAD),
  },

  projectStartupSettings: {
    loadAll: () =>
      ipcRenderer.invoke(IPC.PROJECT_STARTUP_SETTINGS_LOAD_ALL) as Promise<Record<string, { name: string; command: string }[]>>,
    get: (repoPath: string) =>
      ipcRenderer.invoke(IPC.PROJECT_STARTUP_SETTINGS_GET, repoPath) as Promise<Array<{ name: string; command: string }> | null>,
    set: (repoPath: string, startupCommands: Array<{ name: string; command: string }>) =>
      ipcRenderer.invoke(IPC.PROJECT_STARTUP_SETTINGS_SET, repoPath, startupCommands) as Promise<Array<{ name: string; command: string }>>,
    delete: (repoPath: string) =>
      ipcRenderer.invoke(IPC.PROJECT_STARTUP_SETTINGS_DELETE, repoPath) as Promise<void>,
    path: () =>
      ipcRenderer.invoke(IPC.PROJECT_STARTUP_SETTINGS_PATH) as Promise<string>,
  },
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
