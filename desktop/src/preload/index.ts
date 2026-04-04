import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  AutomationConfig,
  AutomationConfigLike,
  AutomationRunStartedEvent,
  AutomationStatusEvent,
  AutomationWorkspaceEvent,
} from '../shared/automation-types'
import type { PhoneControlSettings, PhoneControlStatus } from '../shared/phone-control-types'
import type {
  OrchestratorStatus,
  OrchestratorMessage,
  OrchestratorSession,
  OrchestratorCommandPayload,
  SendBlueStatus,
} from '../shared/orchestrator-types'
import type { CreateWorktreeProgressEvent } from '../shared/workspace-creation'
import type { SyncProgress, SyncResult } from '../shared/sync-types'
import type { PlanAgent } from '../shared/agent-plan-path'
import type { WorktreeSyncEvent } from '../shared/worktree-sync-types'
import type { GraphiteStackInfo } from '../shared/graphite-types'
import type { HunkComment, HunkSessionContext, HunkSessionInfo } from '../shared/hunk-types'
import type { ContextWindowData } from '../shared/context-window-types'

const api = {
  git: {
    listWorktrees: (repoPath: string) =>
      ipcRenderer.invoke(IPC.GIT_LIST_WORKTREES, repoPath),
    checkIsRepo: (dirPath: string) =>
      ipcRenderer.invoke(IPC.GIT_CHECK_IS_REPO, dirPath) as Promise<boolean>,
    initRepo: (dirPath: string) =>
      ipcRenderer.invoke(IPC.GIT_INIT_REPO, dirPath) as Promise<void>,
    createWorktree: (repoPath: string, name: string, branch: string, newBranch: boolean, baseBranch?: string, force?: boolean, requestId?: string) =>
      ipcRenderer.invoke(IPC.GIT_CREATE_WORKTREE, repoPath, name, branch, newBranch, baseBranch, force, requestId),
    createWorktreeFromPr: (repoPath: string, name: string, prNumber: number, localBranch: string, force?: boolean, requestId?: string) =>
      ipcRenderer.invoke(IPC.GIT_CREATE_WORKTREE_FROM_PR, repoPath, name, prNumber, localBranch, force, requestId) as Promise<{ worktreePath: string; branch: string }>,
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
    getCurrentBranch: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_CURRENT_BRANCH, worktreePath) as Promise<string>,
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
    cloneStack: (repoPath: string, name: string, prBranches: { name: string; parent: string | null }[]) =>
      ipcRenderer.invoke(IPC.GRAPHITE_CLONE_STACK, repoPath, name, prBranches) as Promise<{ worktreePath: string; branch: string }>,
    getStackForPr: (repoPath: string, prBranch: string) =>
      ipcRenderer.invoke(IPC.GRAPHITE_GET_STACK_FOR_PR, repoPath, prBranch) as Promise<{ name: string; parent: string | null }[] | null>,
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
    findNewestPlanMarkdown: (worktreePath: string) =>
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
    selectDirectory: () =>
      ipcRenderer.invoke(IPC.APP_SELECT_DIRECTORY),
    selectFile: (filters?: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke(IPC.APP_SELECT_FILE, filters) as Promise<string | null>,
    addProjectPath: (dirPath: string) =>
      ipcRenderer.invoke(IPC.APP_ADD_PROJECT_PATH, dirPath),
    openInEditor: (dirPath: string, cliCommand: string, extraArgs?: string[], openMode?: string) =>
      ipcRenderer.invoke(IPC.APP_OPEN_IN_EDITOR, dirPath, cliCommand, extraArgs, openMode) as Promise<{ success: boolean; error?: string }>,
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
    installHooks: (contextEnabled: boolean) =>
      ipcRenderer.invoke(IPC.CLAUDE_INSTALL_HOOKS, contextEnabled),
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
    installNotify: (contextEnabled?: boolean) =>
      ipcRenderer.invoke(IPC.CODEX_INSTALL_NOTIFY, contextEnabled),
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

  context: {
    repoInit: (projectDir: string, wsId: string) =>
      ipcRenderer.invoke(IPC.CONTEXT_REPO_INIT, projectDir, wsId) as Promise<{ success: boolean }>,
    search: (projectDir: string, query: string, limit?: number) =>
      ipcRenderer.invoke(IPC.CONTEXT_SEARCH, projectDir, query, limit),
    getRecent: (projectDir: string, workspaceId: string, limit?: number) =>
      ipcRenderer.invoke(IPC.CONTEXT_GET_RECENT, projectDir, workspaceId, limit),
    insert: (projectDir: string, entry: {
      workspaceId: string; sessionId?: string; toolName: string;
      toolInput?: string; filePath?: string; timestamp: string;
    }) => ipcRenderer.invoke(IPC.CONTEXT_INSERT, projectDir, entry),
    restoreCheckpoint: (projectDir: string, commitHash: string, relativePaths?: string[]) =>
      ipcRenderer.invoke(IPC.CONTEXT_RESTORE_CHECKPOINT, projectDir, commitHash, relativePaths) as Promise<{ success: boolean; verified: boolean }>,
    buildSummary: (projectDir: string, workspaceId: string) =>
      ipcRenderer.invoke(IPC.CONTEXT_BUILD_SUMMARY, projectDir, workspaceId) as Promise<{ success: boolean; wsContext: string; globalContext: string }>,
    walCheckpoint: (projectDir?: string) =>
      ipcRenderer.invoke(IPC.CONTEXT_WAL_CHECKPOINT, projectDir) as Promise<{ success: boolean }>,
    getSessionContext: (projectDir: string, sessionId: string, limit?: number) =>
      ipcRenderer.invoke(IPC.CONTEXT_SESSION_CONTEXT, projectDir, sessionId, limit),
    saveSessionMeta: (projectDir: string, wsId: string, meta: { sessionId: string; agentType: string; startedAt: string; summary?: string }) =>
      ipcRenderer.invoke(IPC.CONTEXT_SESSION_META_SAVE, projectDir, wsId, meta) as Promise<{ success: boolean }>,
    getSessionMeta: (projectDir: string, wsId: string, agentType?: string) =>
      ipcRenderer.invoke(IPC.CONTEXT_SESSION_META_GET, projectDir, wsId, agentType) as Promise<{ sessionId: string; agentType: string; startedAt: string; summary?: string } | null>,
    onCodexTabTitleHint: (callback: (data: { workspaceId: string; title: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { workspaceId: string; title: string }) => callback(data)
      ipcRenderer.on(IPC.CONTEXT_CODEX_TAB_TITLE_HINT, listener)
      return () => {
        ipcRenderer.removeListener(IPC.CONTEXT_CODEX_TAB_TITLE_HINT, listener)
      }
    },
    onEntriesUpdated: (callback: (data: { projectDir: string; workspaceId: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { projectDir: string; workspaceId: string }) => callback(data)
      ipcRenderer.on(IPC.CONTEXT_ENTRIES_UPDATED, listener)
      return () => {
        ipcRenderer.removeListener(IPC.CONTEXT_ENTRIES_UPDATED, listener)
      }
    },
  },

  session: {
    getLast: (workspaceId: string, agentType: string) =>
      ipcRenderer.invoke(IPC.SESSION_GET_LAST, workspaceId, agentType) as Promise<string | null>,
  },

  clipboard: {
    saveImage: () =>
      ipcRenderer.invoke(IPC.CLIPBOARD_SAVE_IMAGE) as Promise<string | null>,
  },

  hunk: {
    isAvailable: () =>
      ipcRenderer.invoke(IPC.HUNK_AVAILABLE) as Promise<boolean>,
    startSession: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.HUNK_START_SESSION, worktreePath) as Promise<void>,
    stopSession: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.HUNK_STOP_SESSION, worktreePath) as Promise<void>,
    getContext: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.HUNK_GET_CONTEXT, worktreePath) as Promise<HunkSessionContext | null>,
    commentAdd: (worktreePath: string, file: string, newLine: number, summary: string, opts?: { rationale?: string; author?: string; focus?: boolean }) =>
      ipcRenderer.invoke(IPC.HUNK_COMMENT_ADD, worktreePath, file, newLine, summary, opts) as Promise<void>,
    commentList: (worktreePath: string, file?: string) =>
      ipcRenderer.invoke(IPC.HUNK_COMMENT_LIST, worktreePath, file) as Promise<HunkComment[]>,
    commentRemove: (worktreePath: string, commentId: string) =>
      ipcRenderer.invoke(IPC.HUNK_COMMENT_REMOVE, worktreePath, commentId) as Promise<void>,
    commentClear: (worktreePath: string, file?: string) =>
      ipcRenderer.invoke(IPC.HUNK_COMMENT_CLEAR, worktreePath, file) as Promise<void>,
    navigate: (worktreePath: string, file: string, target: { hunk?: number; newLine?: number; oldLine?: number }) =>
      ipcRenderer.invoke(IPC.HUNK_NAVIGATE, worktreePath, file, target) as Promise<void>,
    reload: (worktreePath: string, command: string[]) =>
      ipcRenderer.invoke(IPC.HUNK_RELOAD, worktreePath, command) as Promise<void>,
  },

  orchestrator: {
    start: (settings: unknown) =>
      ipcRenderer.invoke(IPC.ORCHESTRATOR_START, settings),
    stop: () =>
      ipcRenderer.invoke(IPC.ORCHESTRATOR_STOP),
    getStatus: () =>
      ipcRenderer.invoke(IPC.ORCHESTRATOR_STATUS) as Promise<OrchestratorStatus>,
    sendCommand: (payload: OrchestratorCommandPayload) =>
      ipcRenderer.invoke(IPC.ORCHESTRATOR_COMMAND, payload),
    getSessions: () =>
      ipcRenderer.invoke(IPC.ORCHESTRATOR_SESSIONS) as Promise<OrchestratorSession[]>,
    getMessages: () =>
      ipcRenderer.invoke(IPC.ORCHESTRATOR_MESSAGES) as Promise<OrchestratorMessage[]>,
    onStatusChanged: (callback: (status: OrchestratorStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: OrchestratorStatus) => callback(status)
      ipcRenderer.on(IPC.ORCHESTRATOR_STATUS_CHANGED, listener)
      return () => { ipcRenderer.removeListener(IPC.ORCHESTRATOR_STATUS_CHANGED, listener) }
    },
    onSessionUpdated: (callback: (session: OrchestratorSession) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, session: OrchestratorSession) => callback(session)
      ipcRenderer.on(IPC.ORCHESTRATOR_SESSION_UPDATED, listener)
      return () => { ipcRenderer.removeListener(IPC.ORCHESTRATOR_SESSION_UPDATED, listener) }
    },
    onMessageReceived: (callback: (msg: OrchestratorMessage) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, msg: OrchestratorMessage) => callback(msg)
      ipcRenderer.on(IPC.ORCHESTRATOR_MESSAGE_RECEIVED, listener)
      return () => { ipcRenderer.removeListener(IPC.ORCHESTRATOR_MESSAGE_RECEIVED, listener) }
    },
  },

  sendblue: {
    getStatus: () =>
      ipcRenderer.invoke(IPC.SENDBLUE_STATUS) as Promise<SendBlueStatus>,
    send: (to: string, message: string) =>
      ipcRenderer.invoke(IPC.SENDBLUE_SEND, to, message),
    test: (settings: unknown) =>
      ipcRenderer.invoke(IPC.SENDBLUE_TEST, settings),
  },

  phoneControl: {
    start: (settings: PhoneControlSettings) =>
      ipcRenderer.invoke(IPC.PHONE_CONTROL_START, settings),
    stop: () =>
      ipcRenderer.invoke(IPC.PHONE_CONTROL_STOP),
    status: () =>
      ipcRenderer.invoke(IPC.PHONE_CONTROL_STATUS) as Promise<PhoneControlStatus>,
    testSend: (message: string) =>
      ipcRenderer.invoke(IPC.PHONE_CONTROL_TEST_SEND, message),
    openFullDiskAccessSettings: () =>
      ipcRenderer.invoke(IPC.PHONE_CONTROL_OPEN_FULL_DISK_ACCESS),
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
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
