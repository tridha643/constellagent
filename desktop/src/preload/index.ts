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
import type { CloneRepoOptions, CloneRepoProgressEvent, CloneRepoResult } from '../shared/clone-repo'
import type { SyncProgress, SyncResult } from '../shared/sync-types'
import type { AgentPlanSearchRequest, AgentPlanSearchResult, PlanAgent } from '../shared/agent-plan-path'
import type { PiModelOption } from '../shared/plan-build-command'
import type { WorktreeSyncEvent } from '../shared/worktree-sync-types'
import type { GraphiteCreateOptions, GraphiteStackAction, GraphiteStackActionResult, GraphiteStackInfo } from '../shared/graphite-types'
import type { ReviewComment } from '../shared/review-types'
import type { AgentationEvent, AgentationSession, AgentationStatus } from '../shared/agentation-types'
import type { HostUiResponse } from '@pi-gui/session-driver'
import type {
  AgentChatContextPayload,
  AgentChatDeltaPayload,
  AgentChatSessionState,
  AgentChatSessionWithTranscript,
  AgentChatTranscriptPayload,
  CreateAgentChatSessionInput,
  ForkAgentChatSessionInput,
  QueuedAgentMessage,
  QueuedAgentMessageMode,
} from '../shared/agent-chat-types'
import type { ConductorComposerAttachment } from '../shared/conductor-attachments'
import type { ContextWindowData } from '../shared/context-window-types'
import type { QuickOpenSearchRequest, QuickOpenSearchResult } from '../shared/quick-open-types'
import type { LinearFffQuickOpenRequest, LinearFffQuickOpenResult } from '../shared/linear-fff-types'
import type { CodeSearchRequest, CodeSearchResult } from '../shared/code-search-types'
import type { WorktreeCredentialRule } from '../shared/worktree-credentials'
import type { GitHunkActionRequest } from '../shared/git-hunk-action-types'
import type { GithubCloneRepoSuggestion } from '../shared/github-clone-suggestions'
import type { ComposioAutomationDefinition, ComposioAutomationAgent, ComposioNgrokStatus, ComposioWebhookSettings } from '../shared/composio-types'
import type {
  MobileConnectionSnapshot,
  MobileDeployIosAppInput,
  MobileDeployIosAppResult,
  MobilePairingPayloadResult,
  MobileTrustedPhoneSummary,
  MobileUsbIosDevice,
} from '../shared/mobile-settings-types'
import type { CodexWebSocketsSetting } from '../shared/codex-websockets'
import type { SpotlightStatus } from '../shared/spotlight-types'
import type {
  TerminalSessionAttachRequest,
  TerminalSessionAttachResult,
  TerminalSessionAvailability,
  TerminalSessionSummary,
} from '../shared/terminal-session-types'

/** Linear GraphQL via main process (renderer fetch hits CORS). Exposed on `api` and `api.app`. */
function linearGraphql(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
) {
  return ipcRenderer.invoke(IPC.LINEAR_GRAPHQL_REQUEST, apiKey, query, variables) as Promise<{
    data?: unknown
    errors?: { message: string }[]
  }>
}

const api = {
  linearGraphql,
  linearFffQuickOpen: (request: LinearFffQuickOpenRequest) =>
    ipcRenderer.invoke(IPC.LINEAR_FFF_QUICK_OPEN, request) as Promise<LinearFffQuickOpenResult>,
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
    cloneRepo: (opts: CloneRepoOptions) =>
      ipcRenderer.invoke(IPC.GIT_CLONE_REPO, opts) as Promise<CloneRepoResult>,
    cancelClone: (requestId: string) =>
      ipcRenderer.send(IPC.GIT_CLONE_REPO_CANCEL, requestId),
    onCloneRepoProgress: (callback: (progress: CloneRepoProgressEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: CloneRepoProgressEvent) => callback(progress)
      ipcRenderer.on(IPC.GIT_CLONE_REPO_PROGRESS, listener)
      return () => {
        ipcRenderer.removeListener(IPC.GIT_CLONE_REPO_PROGRESS, listener)
      }
    },
    createWorktree: (repoPath: string, name: string, branch: string, newBranch: boolean, baseBranch?: string, force?: boolean, requestId?: string, credentialRules?: WorktreeCredentialRule[]) =>
      ipcRenderer.invoke(IPC.GIT_CREATE_WORKTREE, repoPath, name, branch, newBranch, baseBranch, force, requestId, credentialRules),
    createWorktreeFromPr: (repoPath: string, name: string, prNumber: number, localBranch: string, force?: boolean, requestId?: string, credentialRules?: WorktreeCredentialRule[], options?: import('../main/git-service').CreatePrWorktreeOptions) =>
      ipcRenderer.invoke(IPC.GIT_CREATE_WORKTREE_FROM_PR, repoPath, name, prNumber, localBranch, force, requestId, credentialRules, options) as Promise<import('../main/git-service').PrWorktreeResult>,
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
    getWorkingTreeDiff: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_WORKTREE_DIFF, worktreePath) as Promise<string>,
    getFileDiff: (worktreePath: string, filePath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_FILE_DIFF, worktreePath, filePath),
    getBranches: (repoPath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_BRANCHES, repoPath),
    stage: (worktreePath: string, paths: string[]) =>
      ipcRenderer.invoke(IPC.GIT_STAGE, worktreePath, paths),
    stageAll: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.GIT_STAGE_ALL, worktreePath) as Promise<void>,
    unstage: (worktreePath: string, paths: string[]) =>
      ipcRenderer.invoke(IPC.GIT_UNSTAGE, worktreePath, paths),
    discard: (worktreePath: string, paths: string[], untracked: string[]) =>
      ipcRenderer.invoke(IPC.GIT_DISCARD, worktreePath, paths, untracked),
    applyHunkAction: (worktreePath: string, request: GitHunkActionRequest) =>
      ipcRenderer.invoke(IPC.GIT_APPLY_HUNK_ACTION, worktreePath, request) as Promise<void>,
    commit: (worktreePath: string, message: string) =>
      ipcRenderer.invoke(IPC.GIT_COMMIT, worktreePath, message),
    pushCurrentBranch: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.GIT_PUSH_CURRENT_BRANCH, worktreePath) as Promise<void>,
    pushToPrHead: (worktreePath: string, remote: string, headRefName: string) =>
      ipcRenderer.invoke(IPC.GIT_PUSH_TO_PR_HEAD, worktreePath, remote, headRefName) as Promise<void>,
    fetchAndRebase: (worktreePath: string, remote: string, ref: string) =>
      ipcRenderer.invoke(IPC.GIT_FETCH_AND_REBASE, worktreePath, remote, ref) as Promise<
        { ok: true } | { ok: false; kind: 'conflict'; files: string[] }
      >,
    listRebaseConflicts: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.GIT_LIST_REBASE_CONFLICTS, worktreePath) as Promise<string[]>,
    isAheadOfRemote: (worktreePath: string, remote: string, ref: string) =>
      ipcRenderer.invoke(IPC.GIT_IS_AHEAD_OF_REMOTE, worktreePath, remote, ref) as Promise<boolean>,
    checkoutBranch: (worktreePath: string, branch: string, createNew?: boolean) =>
      ipcRenderer.invoke(IPC.GIT_CHECKOUT_BRANCH, worktreePath, branch, createNew === true) as Promise<void>,
    getCurrentBranch: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_CURRENT_BRANCH, worktreePath) as Promise<string>,
    getCurrentBranches: (repoPath: string, worktreePaths: string[]) =>
      ipcRenderer.invoke(IPC.GIT_GET_CURRENT_BRANCHES, repoPath, worktreePaths) as Promise<Record<string, string>>,
    getHeadHash: (worktreePath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_HEAD_HASH, worktreePath) as Promise<string>,
    getDefaultBranch: (repoPath: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_DEFAULT_BRANCH, repoPath) as Promise<string>,
    getWorkspaceBarStats: (worktreePath: string, defaultBranch?: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_WORKSPACE_BAR_STATS, worktreePath, defaultBranch) as Promise<import('../shared/git-types').WorkspaceBarStats>,
    showFileAtHead: (worktreePath: string, filePath: string) =>
      ipcRenderer.invoke(IPC.GIT_SHOW_FILE_AT_HEAD, worktreePath, filePath) as Promise<string | null>,
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
    create: (workingDir: string, shell?: string, extraEnv?: Record<string, string>, command?: string[]) =>
      ipcRenderer.invoke(IPC.PTY_CREATE, workingDir, shell, extraEnv, command),
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
    snapshot: (ptyId: string) =>
      ipcRenderer.invoke(IPC.PTY_SNAPSHOT, ptyId) as Promise<string>,
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
    onExit: (callback: (data: { ptyId: string; exitCode: number; workspaceId?: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { ptyId: string; exitCode: number; workspaceId?: string }) => callback(data)
      ipcRenderer.on(IPC.PTY_EXIT, listener)
      return () => {
        ipcRenderer.removeListener(IPC.PTY_EXIT, listener)
      }
    },
    /** Track 6: per-tab scrollback persistence (survives app quit/restart). */
    loadScrollback: (key: string) =>
      ipcRenderer.invoke(IPC.PTY_SCROLLBACK_LOAD, key) as Promise<string>,
    saveScrollback: (key: string, text: string) =>
      ipcRenderer.invoke(IPC.PTY_SCROLLBACK_SAVE, key, text) as Promise<boolean>,
    deleteScrollback: (key: string) =>
      ipcRenderer.invoke(IPC.PTY_SCROLLBACK_DELETE, key) as Promise<boolean>,
  },

  terminalSession: {
    availability: () =>
      ipcRenderer.invoke(IPC.TERMINAL_SESSION_AVAILABILITY) as Promise<TerminalSessionAvailability>,
    createAttach: (input: TerminalSessionAttachRequest) =>
      ipcRenderer.invoke(IPC.TERMINAL_SESSION_CREATE_ATTACH, input) as Promise<TerminalSessionAttachResult>,
    attach: (input: TerminalSessionAttachRequest) =>
      ipcRenderer.invoke(IPC.TERMINAL_SESSION_ATTACH, input) as Promise<TerminalSessionAttachResult | { status: 'missing' }>,
    list: (workspaceId?: string) =>
      ipcRenderer.invoke(IPC.TERMINAL_SESSION_LIST, workspaceId) as Promise<TerminalSessionSummary[]>,
    kill: (sessionName: string) =>
      ipcRenderer.invoke(IPC.TERMINAL_SESSION_KILL, sessionName) as Promise<{ ok: boolean }>,
  },

  packageScripts: {
    list: (workingDir: string) =>
      ipcRenderer.invoke(IPC.PACKAGE_SCRIPTS_LIST, workingDir) as Promise<import('../shared/service-types').PackageScriptsResult>,
  },

  fs: {
    getTree: (dirPath: string) =>
      ipcRenderer.invoke(IPC.FS_GET_TREE, dirPath),
    getTreeWithStatus: (dirPath: string) =>
      ipcRenderer.invoke(IPC.FS_GET_TREE_WITH_STATUS, dirPath) as Promise<{
        rootPath: string
        tree: Array<{
          name: string
          path: string
          type: 'file' | 'directory'
          children?: unknown[]
          gitStatus?: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
        }>
      }>,
    listDirectory: (rootPath: string, dirPath: string) =>
      ipcRenderer.invoke(IPC.FS_LIST_DIRECTORY, rootPath, dirPath) as Promise<{
        rootPath: string
        entries: Array<{
          name: string
          path: string
          type: 'file' | 'directory'
          gitStatus?: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
        }>
      }>,
    quickOpenSearch: (worktreePath: string, request: QuickOpenSearchRequest) =>
      ipcRenderer.invoke(IPC.FS_QUICK_OPEN_SEARCH, worktreePath, request) as Promise<QuickOpenSearchResult>,
    codeSearch: (worktreePath: string, request: CodeSearchRequest) =>
      ipcRenderer.invoke(IPC.FS_CODE_SEARCH, worktreePath, request) as Promise<CodeSearchResult>,
    searchAgentPlans: (worktreePath: string | string[], request: AgentPlanSearchRequest) =>
      ipcRenderer.invoke(IPC.FS_SEARCH_AGENT_PLANS, worktreePath, request) as Promise<AgentPlanSearchResult>,
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
    generateLinearIssueDraft: (payload: {
      projectName: string
      worktreePath: string | null
      projectDescription?: string | null
      projectContentMarkdown?: string | null
      existingTitle?: string | null
      existingDescription?: string | null
    }) =>
      ipcRenderer.invoke(IPC.APP_GENERATE_LINEAR_ISSUE_DRAFT, payload) as Promise<{
        title: string
        description: string
      }>,
    generateLinearUpdateDraft: (payload: {
      projectName: string
      pastUpdates: string[]
      worktreePath: string | null
      projectDescription?: string | null
      projectContentMarkdown?: string | null
    }) =>
      ipcRenderer.invoke(IPC.APP_GENERATE_LINEAR_UPDATE_DRAFT, payload) as Promise<{ body: string }>,
    selectDirectory: () =>
      ipcRenderer.invoke(IPC.APP_SELECT_DIRECTORY),
    selectFile: (filters?: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke(IPC.APP_SELECT_FILE, filters) as Promise<string | null>,
    addProjectPath: (dirPath: string) =>
      ipcRenderer.invoke(IPC.APP_ADD_PROJECT_PATH, dirPath),
    openInEditor: (dirPath: string, cliCommand: string, extraArgs?: string[], openMode?: string) =>
      ipcRenderer.invoke(IPC.APP_OPEN_IN_EDITOR, dirPath, cliCommand, extraArgs, openMode) as Promise<{ success: boolean; error?: string }>,
    relaunch: () => ipcRenderer.invoke(IPC.APP_RELAUNCH) as Promise<void>,
    openExternal: (url: string) => ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, url) as Promise<void>,
    linearGraphql,
  },

  skills: {
    scan: (skillPath: string) =>
      ipcRenderer.invoke(IPC.SKILLS_SCAN, skillPath) as Promise<{ name: string; description: string } | null>,
    discoverHarness: (provider: import('../shared/agent-chat-types').AgentProvider, workspacePath: string) =>
      ipcRenderer.invoke(IPC.SKILLS_DISCOVER_HARNESS, provider, workspacePath) as Promise<
        Array<{ name: string; description: string; sourcePath: string }>
      >,
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
    getRateLimits: () =>
      ipcRenderer.invoke(IPC.CODEX_GET_RATE_LIMITS),
    getPersonality: () =>
      ipcRenderer.invoke(IPC.CODEX_GET_PERSONALITY) as Promise<{
        personality: 'pragmatic' | 'friendly' | 'none'
      }>,
    setPersonality: (personality: 'pragmatic' | 'friendly' | 'none') =>
      ipcRenderer.invoke(IPC.CODEX_SET_PERSONALITY, personality) as Promise<{
        personality: 'pragmatic' | 'friendly' | 'none'
      }>,
  },

  cursor: {
    getRateLimits: () =>
      ipcRenderer.invoke(IPC.CURSOR_GET_RATE_LIMITS),
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

  composio: {
    getWebhookStatus: () => ipcRenderer.invoke(IPC.COMPOSIO_WEBHOOK_STATUS),
    applyWebhookSettings: (settings: ComposioWebhookSettings) =>
      ipcRenderer.invoke(IPC.COMPOSIO_WEBHOOK_APPLY_SETTINGS, settings),
    subscribeWebhook: (input?: { publicBaseUrl?: string }) =>
      ipcRenderer.invoke(IPC.COMPOSIO_SUBSCRIBE_WEBHOOK, input) as Promise<{
        id?: string
        secret?: string
        reusedExisting?: boolean
      }>,
    getNgrokStatus: () => ipcRenderer.invoke(IPC.COMPOSIO_NGROK_STATUS) as Promise<ComposioNgrokStatus>,
    startNgrok: (localPort: number) =>
      ipcRenderer.invoke(IPC.COMPOSIO_NGROK_START, localPort) as Promise<ComposioNgrokStatus>,
    stopNgrok: () => ipcRenderer.invoke(IPC.COMPOSIO_NGROK_STOP) as Promise<ComposioNgrokStatus>,
    suggestGithubConnectedAccountId: () =>
      ipcRenderer.invoke(IPC.COMPOSIO_SUGGEST_GITHUB_CONNECTED_ACCOUNT) as Promise<{
        connectedAccountId: string | null
      }>,
    upsertTrigger: (input: {
      slug: string
      connectedAccountId: string
      triggerConfig: Record<string, unknown>
      apiKey?: string
    }) => ipcRenderer.invoke(IPC.COMPOSIO_UPSERT_TRIGGER, input),
    parsePiDraft: (jsonText: string) => ipcRenderer.invoke(IPC.COMPOSIO_PARSE_PI_DRAFT, jsonText),
    listAutomationDefinitions: (repoPaths?: string[]) =>
      ipcRenderer.invoke(IPC.COMPOSIO_LIST_AUTOMATION_DEFINITIONS, repoPaths) as Promise<ComposioAutomationDefinition[]>,
    setAutomationDefinitionEnabled: (input: { repoPath: string; id: string; enabled: boolean }) =>
      ipcRenderer.invoke(IPC.COMPOSIO_SET_AUTOMATION_DEFINITION_ENABLED, input) as Promise<ComposioAutomationDefinition>,
    setAutomationDefinitionInstructions: (input: { repoPath: string; id: string; instructions: string }) =>
      ipcRenderer.invoke(IPC.COMPOSIO_SET_AUTOMATION_DEFINITION_INSTRUCTIONS, input) as Promise<ComposioAutomationDefinition>,
    setAutomationDefinitionAgent: (input: { repoPath: string; id: string; agent: ComposioAutomationAgent }) =>
      ipcRenderer.invoke(IPC.COMPOSIO_SET_AUTOMATION_DEFINITION_AGENT, input) as Promise<ComposioAutomationDefinition>,
  },

  mobile: {
    getStatus: () => ipcRenderer.invoke(IPC.MOBILE_GET_STATUS) as Promise<MobileConnectionSnapshot>,
    createPairingPayload: () =>
      ipcRenderer.invoke(IPC.MOBILE_CREATE_PAIRING_PAYLOAD) as Promise<MobilePairingPayloadResult>,
    listTrustedDevices: () =>
      ipcRenderer.invoke(IPC.MOBILE_LIST_TRUSTED_DEVICES) as Promise<MobileTrustedPhoneSummary[]>,
    revokeTrustedDevice: (phoneDeviceId: string) =>
      ipcRenderer.invoke(IPC.MOBILE_REVOKE_TRUSTED_DEVICE, phoneDeviceId) as Promise<{ ok: boolean }>,
    listUsbDevices: () => ipcRenderer.invoke(IPC.MOBILE_LIST_USB_DEVICES) as Promise<MobileUsbIosDevice[]>,
    deployIosApp: (input: MobileDeployIosAppInput) =>
      ipcRenderer.invoke(IPC.MOBILE_DEPLOY_IOS_APP, input) as Promise<MobileDeployIosAppResult>,
    onFocusSession: (
      listener: (payload: {
        sessionId: string
        workspaceId: string
        workspacePath: string
        title?: string
      }) => void,
    ) => {
      const handle = (_event: unknown, payload: {
        sessionId: string
        workspaceId: string
        workspacePath: string
        title?: string
      }) => listener(payload)
      ipcRenderer.on(IPC.MOBILE_FOCUS_SESSION, handle)
      return () => {
        ipcRenderer.removeListener(IPC.MOBILE_FOCUS_SESSION, handle)
      }
    },
    onWorkspaceCreated: (
      listener: (payload: {
        project: { id: string; name: string; repoPath: string }
        workspace: {
          id: string
          name: string
          branch: string
          worktreePath: string
          projectId: string
        }
      }) => void,
    ) => {
      const handle = (_event: unknown, payload: {
        project: { id: string; name: string; repoPath: string }
        workspace: {
          id: string
          name: string
          branch: string
          worktreePath: string
          projectId: string
        }
      }) => listener(payload)
      ipcRenderer.on(IPC.MOBILE_WORKSPACE_CREATED, handle)
      return () => {
        ipcRenderer.removeListener(IPC.MOBILE_WORKSPACE_CREATED, handle)
      }
    },
  },

  github: {
    getPrStatuses: (repoPath: string, branches: string[]) =>
      ipcRenderer.invoke(IPC.GITHUB_GET_PR_STATUSES, repoPath, branches),
    getPrStatusesByNumber: (repoPath: string, numbers: number[]) =>
      ipcRenderer.invoke(IPC.GITHUB_GET_PR_STATUSES_BY_NUMBER, repoPath, numbers),
    listOpenPrs: (repoPath: string) =>
      ipcRenderer.invoke(IPC.GITHUB_LIST_OPEN_PRS, repoPath),
    resolvePr: (repoPath: string, prNumber: number, repoSlug?: string) =>
      ipcRenderer.invoke(IPC.GITHUB_RESOLVE_PR, repoPath, prNumber, repoSlug) as Promise<import('../shared/github-types').ResolvedPrInfo>,
    createPr: (repoPath: string, headBranch: string, baseBranch: string) =>
      ipcRenderer.invoke(IPC.GITHUB_CREATE_PR, repoPath, headBranch, baseBranch) as Promise<{ number: number; url: string }>,
    reopenPr: (repoPath: string, prNumber: number) =>
      ipcRenderer.invoke(IPC.GITHUB_REOPEN_PR, repoPath, prNumber) as Promise<{ number: number; url: string }>,
    getPrReviewComments: (repoPath: string, prNumber: number) =>
      ipcRenderer.invoke(IPC.GITHUB_GET_PR_REVIEW_COMMENTS, repoPath, prNumber) as Promise<import('../main/github-service').PrReviewComment[]>,
    listCloneRepoSuggestions: (query: string) =>
      ipcRenderer.invoke(IPC.GITHUB_CLONE_SUGGESTIONS, query) as Promise<GithubCloneRepoSuggestion[]>,
    getRepoInfo: (repoPath: string) =>
      ipcRenderer.invoke(IPC.GITHUB_GET_REPO_INFO, repoPath) as Promise<import('../shared/github-url').GithubRepoInfo | null>,
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
    probeStatus: (provider: import('../shared/agent-chat-types').AgentProvider, workspacePath: string) =>
      ipcRenderer.invoke(IPC.MCP_PROBE_STATUS, provider, workspacePath) as Promise<{
        servers: Array<{ name: string; status: 'ok' | 'error' | 'unknown'; detail?: string }>
        probedAt: number
      }>,
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
    commentAdd: (worktreePath: string, file: string, newLine: number, summary: string, opts?: { id?: string; rationale?: string; author?: string; focus?: boolean; oldLine?: number; force?: boolean; lineEnd?: number; workspaceId?: string }) =>
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

  agentation: {
    status: () =>
      ipcRenderer.invoke(IPC.AGENTATION_STATUS) as Promise<AgentationStatus>,
    listSessions: () =>
      ipcRenderer.invoke(IPC.AGENTATION_LIST_SESSIONS) as Promise<AgentationSession[]>,
    resolve: (annotationId: string) =>
      ipcRenderer.invoke(IPC.AGENTATION_RESOLVE, annotationId) as Promise<{ ok: boolean; error?: string }>,
    dismiss: (annotationId: string) =>
      ipcRenderer.invoke(IPC.AGENTATION_DISMISS, annotationId) as Promise<{ ok: boolean; error?: string }>,
    setEndpoint: (endpoint: string) =>
      ipcRenderer.invoke(IPC.AGENTATION_SET_ENDPOINT, endpoint) as Promise<AgentationStatus>,
    onEvent: (callback: (event: AgentationEvent) => void) => {
      const listener = (_e: unknown, event: AgentationEvent) => callback(event)
      ipcRenderer.on(IPC.AGENTATION_EVENT, listener)
      return () => { ipcRenderer.removeListener(IPC.AGENTATION_EVENT, listener) }
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

  projectIcon: {
    pick: (projectId: string) =>
      ipcRenderer.invoke(IPC.PROJECT_ICON_PICK, projectId) as Promise<
        import('../main/project-icon-service').PickCustomIconResult
      >,
    get: (projectId: string) =>
      ipcRenderer.invoke(IPC.PROJECT_ICON_GET, projectId) as Promise<string | null>,
    clear: (projectId: string) =>
      ipcRenderer.invoke(IPC.PROJECT_ICON_CLEAR, projectId) as Promise<void>,
  },

  agentChat: {
    createSession: (input: CreateAgentChatSessionInput) =>
      ipcRenderer.invoke(IPC.AGENT_CHAT_CREATE_SESSION, input) as Promise<AgentChatSessionState>,
    forkSession: (input: ForkAgentChatSessionInput) =>
      ipcRenderer.invoke(IPC.AGENT_CHAT_FORK_SESSION, input) as Promise<AgentChatSessionState>,
    listSessions: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.AGENT_CHAT_LIST_SESSIONS, workspaceId) as Promise<AgentChatSessionState[]>,
    getSession: (sessionId: string) =>
      ipcRenderer.invoke(IPC.AGENT_CHAT_GET_SESSION, sessionId) as Promise<AgentChatSessionWithTranscript | null>,
    getContextUsage: (sessionId: string) =>
      ipcRenderer.invoke(IPC.AGENT_CHAT_GET_CONTEXT_USAGE, sessionId) as Promise<
        import('../shared/context-window-types').ContextWindowData | null
      >,
    submit: (
      sessionId: string,
      text: string,
      deliverAs?: QueuedAgentMessageMode,
      attachments?: readonly ConductorComposerAttachment[],
    ) => ipcRenderer.invoke(IPC.AGENT_CHAT_SUBMIT, sessionId, text, deliverAs, attachments),
    compactSession: (sessionId: string, customInstructions?: string) =>
      ipcRenderer.invoke(IPC.AGENT_CHAT_COMPACT_SESSION, sessionId, customInstructions),
    pickImages: () =>
      ipcRenderer.invoke(IPC.AGENT_CHAT_PICK_IMAGES) as Promise<{
        attachments: readonly ConductorComposerAttachment[]
        error?: string
      }>,
    listPiModels: (workspacePath: string) =>
      ipcRenderer.invoke(IPC.AGENT_CHAT_LIST_PI_MODELS, workspacePath) as Promise<
        readonly import('../shared/plan-build-command').ModelPreset[]
      >,
    replaceQueue: (sessionId: string, messages: readonly QueuedAgentMessage[]) =>
      ipcRenderer.invoke(IPC.AGENT_CHAT_REPLACE_QUEUE, sessionId, messages),
    setModel: (sessionId: string, model: string) => ipcRenderer.invoke(IPC.AGENT_CHAT_SET_MODEL, sessionId, model),
    setPlan: (sessionId: string, plan: boolean) => ipcRenderer.invoke(IPC.AGENT_CHAT_SET_PLAN, sessionId, plan),
    setCanvas: (sessionId: string, canvas: boolean) =>
      ipcRenderer.invoke(IPC.AGENT_CHAT_SET_CANVAS, sessionId, canvas),
    setThinkingLevel: (sessionId: string, thinkingLevel: import('../shared/conductor-thinking').ThinkingLevel) =>
      ipcRenderer.invoke(IPC.AGENT_CHAT_SET_THINKING_LEVEL, sessionId, thinkingLevel),
    cancel: (sessionId: string) => ipcRenderer.invoke(IPC.AGENT_CHAT_CANCEL, sessionId),
    respondBlockingQuestion: (
      sessionId: string,
      response: import('../shared/conductor-ask-question-types').ConductorBlockingQuestionResponse,
    ) => ipcRenderer.invoke(IPC.AGENT_CHAT_RESPOND_BLOCKING_QUESTION, sessionId, response),
    simulateCodexRequestUserInput: (
      sessionId: string,
      questions: import('../shared/conductor-ask-question-types').ConductorAskQuestionPrompt[],
      itemId?: string,
    ) => ipcRenderer.invoke(IPC.AGENT_CHAT_SIMULATE_CODEX_REQUEST_USER_INPUT, sessionId, questions, itemId),
    respondPiHostUi: (
      sessionId: string,
      response: import('@pi-gui/session-driver').HostUiResponse,
    ) => ipcRenderer.invoke(IPC.AGENT_CHAT_RESPOND_PI_HOST_UI, sessionId, response),
    sendPiExtensionTuiInput: (sessionId: string, data: string) =>
      ipcRenderer.invoke(IPC.AGENT_CHAT_PI_EXTENSION_TUI_INPUT, sessionId, data),
    deleteSession: (sessionId: string) => ipcRenderer.invoke(IPC.AGENT_CHAT_DELETE_SESSION, sessionId),
    getAuthStatus: (force?: boolean) => ipcRenderer.invoke(IPC.AGENT_CHAT_GET_AUTH_STATUS, force),
    syncAuth: (input: { cursorApiKey: string; openaiApiKey: string; codexWebSockets?: CodexWebSocketsSetting }) =>
      ipcRenderer.invoke(IPC.CONDUCTOR_AUTH_SYNC, input),
    onStateChanged: (listener: (state: AgentChatSessionState) => void) => {
      const handle = (_event: Electron.IpcRendererEvent, state: AgentChatSessionState) => listener(state)
      ipcRenderer.on(IPC.AGENT_CHAT_STATE_CHANGED, handle)
      return () => {
        ipcRenderer.removeListener(IPC.AGENT_CHAT_STATE_CHANGED, handle)
      }
    },
    onTranscriptChanged: (listener: (payload: AgentChatTranscriptPayload) => void) => {
      const handle = (_event: Electron.IpcRendererEvent, payload: AgentChatTranscriptPayload) => listener(payload)
      ipcRenderer.on(IPC.AGENT_CHAT_TRANSCRIPT_CHANGED, handle)
      return () => {
        ipcRenderer.removeListener(IPC.AGENT_CHAT_TRANSCRIPT_CHANGED, handle)
      }
    },
    onAssistantDelta: (listener: (payload: AgentChatDeltaPayload) => void) => {
      const handle = (_event: Electron.IpcRendererEvent, payload: AgentChatDeltaPayload) => listener(payload)
      ipcRenderer.on(IPC.AGENT_CHAT_ASSISTANT_DELTA, handle)
      return () => {
        ipcRenderer.removeListener(IPC.AGENT_CHAT_ASSISTANT_DELTA, handle)
      }
    },
    onContextChanged: (listener: (payload: AgentChatContextPayload) => void) => {
      const handle = (_event: Electron.IpcRendererEvent, payload: AgentChatContextPayload) => listener(payload)
      ipcRenderer.on(IPC.AGENT_CHAT_CONTEXT_CHANGED, handle)
      return () => {
        ipcRenderer.removeListener(IPC.AGENT_CHAT_CONTEXT_CHANGED, handle)
      }
    },
  },
  spotlight: {
    enable: (opts: { projectId: string; workspaceId: string; worktreePath: string; rootPath: string }) =>
      ipcRenderer.invoke(IPC.SPOTLIGHT_ENABLE, opts) as Promise<SpotlightStatus>,
    disable: (projectId: string) =>
      ipcRenderer.invoke(IPC.SPOTLIGHT_DISABLE, projectId) as Promise<void>,
    getStatus: (projectId?: string) =>
      ipcRenderer.invoke(IPC.SPOTLIGHT_GET_STATUS, projectId) as Promise<SpotlightStatus[]>,
    onStatus: (callback: (status: SpotlightStatus) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, status: SpotlightStatus) => callback(status)
      ipcRenderer.on(IPC.SPOTLIGHT_STATUS, listener)
      return () => {
        ipcRenderer.removeListener(IPC.SPOTLIGHT_STATUS, listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
