import type { editor } from 'monaco-editor'
import type { LinearIssueNode } from '../linear/linear-api'
import type { PrInfo } from '@shared/github-types'
import type { WorkspaceSyncInfo } from '@shared/worktree-sync-types'
import type { ContextWindowData } from '@shared/context-window-types'
import type { AutomationAction, AutomationTrigger, AutomationRunStatus } from '../../shared/automation-types'
import type { WorktreeCredentialRule } from '../../shared/worktree-credentials'
import type { GraphiteStackInfo } from '../../shared/graphite-types'
import type { AppearanceThemeId } from '../theme/appearance'
import type { EditorLanguageOverride } from '../utils/language-map'
import type { GitStatusSnapshot, WorkingTreeDiffSnapshot } from '../types/working-tree-diff'
import { getDefaultWorktreeCredentialRules } from '../../shared/worktree-credentials'

/** Used with `waitFor`: how long / how to wait after the dependency before starting this command */
export type WaitCondition =
  | { type: 'delay'; seconds: number }
  | { type: 'output'; pattern: string }

export interface StartupCommand {
  name: string
  command: string
  waitFor?: string          // name of another StartupCommand to wait on
  waitCondition?: WaitCondition
}

export interface Automation {
  id: string
  name: string
  projectId: string
  prompt: string
  cronExpression: string
  enabled: boolean
  createdAt: number
  trigger?: AutomationTrigger
  action?: AutomationAction
  cooldownMs?: number
  lastRunAt?: number
  lastRunStatus?: AutomationRunStatus
}

export interface SkillEntry {
  id: string
  name: string
  description: string
  sourcePath: string
  enabled: boolean
}

export interface SubagentEntry {
  id: string
  name: string
  description: string
  sourcePath: string
  tools?: string
  enabled: boolean
}

export interface Project {
  id: string
  name: string
  repoPath: string
  startupCommands?: StartupCommand[]
  prLinkProvider?: PrLinkProvider
  graphiteNewBranchSource?: GraphiteNewBranchSource
  graphitePreferredTrunk?: string | null
}

export interface Workspace {
  id: string
  name: string
  branch: string
  worktreePath: string
  projectId: string
  /** When opened from Linear “agent for issue”, links back for sidebar / issue click navigation. */
  linearIssueId?: string
  automationId?: string
  /**
   * For linked worktrees only: branch this workspace was created on.
   * Used as Graphite "UI trunk" so Start vs Add / Submit matches the worktree’s home branch.
   */
  graphiteUiTrunkBranch?: string | null
}

export type SplitLeaf =
  | { type: 'leaf'; id: string; contentType: 'terminal'; ptyId: string }
  | { type: 'leaf'; id: string; contentType: 'file'; filePath: string }

export type SplitNode =
  | SplitLeaf
  | { type: 'split'; id: string; direction: 'horizontal' | 'vertical'; children: [SplitNode, SplitNode] }

export type Tab = {
  id: string
  workspaceId: string
} & (
  | { type: 'terminal'; title: string; ptyId: string; agentType?: AgentType; splitRoot?: SplitNode; focusedPaneId?: string }
  | { type: 'file'; filePath: string; unsaved?: boolean; deleted?: boolean; splitRoot?: SplitNode; focusedPaneId?: string }
  | { type: 'diff'; commitHash?: string; commitMessage?: string }
  | { type: 'markdownPreview'; filePath: string; title: string }
  | { type: 't3code'; title: string; serverUrl: string }
  | { type: 'pi-thread'; title: string; piSessionId?: string; piSessionTitle?: string }
)

export type RightPanelMode = 'files' | 'changes' | 'graph'

export type PrLinkProvider = 'github' | 'graphite' | 'devinreview'

export type GraphiteNewBranchSource = 'trunk' | 'branch'

export type FavoriteEditor = 'cursor' | 'vscode' | 'zed' | 'sublime' | 'webstorm' | 'custom'

export type EditorOpenMode = 'agents-window'

export interface EditorPreset {
  name: string
  cli: string
  extraArgs?: string[]
  openMode?: EditorOpenMode
}

export const EDITOR_PRESETS: Record<Exclude<FavoriteEditor, 'custom'>, EditorPreset> = {
  cursor: { name: 'Cursor Agents', cli: 'cursor', extraArgs: ['--new-window'], openMode: 'agents-window' },
  vscode: { name: 'VS Code', cli: 'code' },
  zed: { name: 'Zed', cli: 'zed' },
  sublime: { name: 'Sublime Text', cli: 'subl' },
  webstorm: { name: 'WebStorm', cli: 'webstorm' },
} as const

/** Resolve the CLI command and display name for the current favorite editor setting */
export function resolveEditor(settings: Settings): EditorPreset {
  if (settings.favoriteEditor === 'custom') {
    const cli = settings.favoriteEditorCustom || 'code'
    return { name: cli, cli }
  }
  return EDITOR_PRESETS[settings.favoriteEditor]
}

export interface McpServer {
  id: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
}

export type AgentType = 'claude-code' | 'codex' | 'gemini' | 'cursor' | 'opencode' | 'pi-constell'

export type AgentMcpAssignments = Record<AgentType, string[]>

/** Persisted row in the Linear workspace “project updates” bar. */
export interface LinearProjectUpdateBarEntry {
  linearProjectId: string
  labelOverride?: string
  pinned?: boolean
  /** User-authored note shown in the updates bar. */
  note?: string
}

/** Selected tool in the Linear panel header cluster (Search / Refresh / Settings). Persisted. */
export type LinearWorkspaceToolbarTool = 'search' | 'refresh' | 'settings'

export function normalizeLinearWorkspaceToolbarTool(
  v: unknown,
): LinearWorkspaceToolbarTool {
  if (v === 'search' || v === 'refresh' || v === 'settings') return v
  return 'search'
}

/** Linear panel main view: issues list, tickets composer, or project updates composer. */
export type LinearWorkspaceView = 'issues' | 'tickets' | 'updates'

export type LinearWorkspaceTab = LinearWorkspaceView

const LINEAR_WORKSPACE_TAB_ORDER_DEFAULT: LinearWorkspaceTab[] = [
  'issues',
  'tickets',
  'updates',
]

export function normalizeLinearWorkspaceView(v: unknown): LinearWorkspaceView {
  if (v === 'issues' || v === 'tickets' || v === 'updates') return v
  return 'issues'
}

/** Persisted order of the three-segment Linear workspace pill. Drops unknowns; appends any missing tab ids. */
export function normalizeLinearWorkspaceTabOrder(v: unknown): LinearWorkspaceTab[] {
  const all = LINEAR_WORKSPACE_TAB_ORDER_DEFAULT
  if (!Array.isArray(v)) return [...all]
  const seen = new Set<string>()
  const out: LinearWorkspaceTab[] = []
  for (const x of v) {
    if (x === 'issues' || x === 'tickets' || x === 'updates') {
      if (!seen.has(x)) {
        seen.add(x)
        out.push(x)
      }
    }
  }
  for (const t of all) {
    if (!seen.has(t)) out.push(t)
  }
  return out
}

/** Next tab in the segmented pill order (wrap). */
export function linearWorkspaceViewNext(
  current: LinearWorkspaceView,
  order: LinearWorkspaceTab[],
): LinearWorkspaceView {
  if (order.length === 0) return current
  const i = order.indexOf(current)
  const idx = i < 0 ? 0 : (i + 1) % order.length
  return order[idx] ?? current
}

/** Previous tab in the segmented pill order (wrap). */
export function linearWorkspaceViewPrev(
  current: LinearWorkspaceView,
  order: LinearWorkspaceTab[],
): LinearWorkspaceView {
  if (order.length === 0) return current
  const i = order.indexOf(current)
  const idx = i < 0 ? order.length - 1 : (i - 1 + order.length) % order.length
  return order[idx] ?? current
}

export type LinearIssueScope = 'assigned' | 'created'

export function normalizeLinearIssueScope(v: unknown): LinearIssueScope {
  if (v === 'assigned' || v === 'created') return v
  return 'assigned'
}

/** Client-side filter on fetched issues: Linear priority 1–4, or all. */
export type LinearIssuesPriorityPreset = 'all' | '1' | '2' | '3' | '4'

export function normalizeLinearIssuesPriorityPreset(
  v: unknown,
): LinearIssuesPriorityPreset {
  if (v === 'all' || v === '1' || v === '2' || v === '3' || v === '4') return v
  return 'all'
}

const LINEAR_ISSUE_CODING_AGENTS: readonly AgentType[] = [
  'claude-code',
  'codex',
  'gemini',
  'cursor',
  'opencode',
  'pi-constell',
]

export function normalizeLinearIssueCodingAgent(v: unknown): AgentType {
  if (typeof v === 'string' && (LINEAR_ISSUE_CODING_AGENTS as readonly string[]).includes(v)) {
    return v as AgentType
  }
  return 'claude-code'
}

export function normalizeLinearIssueCodingModel(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export interface Settings {
  appearanceThemeId: AppearanceThemeId
  confirmOnClose: boolean
  autoSaveOnBlur: boolean
  defaultShell: string
  restoreWorkspace: boolean
  diffInline: boolean
  diffShowFullContextByDefault: boolean
  hunkReviewWidthPx?: number
  terminalFontSize: number
  editorFontSize: number
  /** When false, Monaco skips TS/JS semantic checks (no node_modules in-browser). Syntax errors still show. */
  editorMonacoSemanticDiagnostics: boolean
  /** Persisted per-file Monaco language mode keyed by worktree/file path. */
  editorLanguageOverrides: Record<string, EditorLanguageOverride>
  favoriteEditor: FavoriteEditor
  favoriteEditorCustom: string
  mcpServers: McpServer[]
  agentMcpAssignments: AgentMcpAssignments
  sessionResumeEnabled: boolean
  worktreeCredentialRules: WorktreeCredentialRule[]
  skills: SkillEntry[]
  subagents: SubagentEntry[]
  t3CodeCollapseSidePanels: boolean
  /** Linear Personal API key (Settings only; persisted in app state JSON). */
  linearApiKey: string
  /** Ordered projects shown in the Linear panel updates bar. */
  linearProjectUpdateBar: LinearProjectUpdateBarEntry[]
  /** Project ids highlighted in the Linear panel Projects list. */
  linearFavoriteProjectIds: string[]
  /** Last-selected Linear header tool; used with Run in the grouped toolbar. */
  linearWorkspaceToolbarTool: LinearWorkspaceToolbarTool
  /** Linear panel: Issues / Tickets / Updates (segmented pill). */
  linearWorkspaceView: LinearWorkspaceView
  /** Order of segments in the Linear workspace pill (drag-and-drop). */
  linearWorkspaceTabOrder: LinearWorkspaceTab[]
  /** Default issue list: assigned to me vs created by me. */
  linearIssueScope: LinearIssueScope
  /** Default priority filter for the Issues list (client-side). */
  linearIssuesPriorityPreset: LinearIssuesPriorityPreset
  /** Copy created Linear issue URLs to the clipboard from the Tickets composer success flow. */
  linearCopyCreatedIssueToClipboard: boolean
  /** Coding agent CLI when opening a Linear issue in a new worktree (Issues row / Tickets toast). */
  linearIssueCodingAgent: AgentType
  /**
   * Model passed to the agent CLI (`--model`). Empty = omit flag (CLI default).
   * Value can be a preset id or custom string (same as plan build).
   */
  linearIssueCodingModel: string
}

export const DEFAULT_SETTINGS: Settings = {
  appearanceThemeId: 'default',
  confirmOnClose: true,
  autoSaveOnBlur: false,
  defaultShell: '',
  restoreWorkspace: true,
  diffInline: false,
  diffShowFullContextByDefault: false,
  hunkReviewWidthPx: undefined,
  terminalFontSize: 14,
  editorFontSize: 13,
  editorMonacoSemanticDiagnostics: false,
  editorLanguageOverrides: {},
  favoriteEditor: 'cursor',
  favoriteEditorCustom: '',
  mcpServers: [],
  agentMcpAssignments: { 'claude-code': [], 'codex': [], 'gemini': [], 'cursor': [], 'opencode': [], 'pi-constell': [] },
  sessionResumeEnabled: true,
  worktreeCredentialRules: getDefaultWorktreeCredentialRules(),
  skills: [],
  subagents: [],
  t3CodeCollapseSidePanels: false,
  linearApiKey: '',
  linearProjectUpdateBar: [],
  linearFavoriteProjectIds: [],
  linearWorkspaceToolbarTool: 'search',
  linearWorkspaceView: 'issues',
  linearWorkspaceTabOrder: ['issues', 'tickets', 'updates'],
  linearIssueScope: 'assigned',
  linearIssuesPriorityPreset: 'all',
  linearCopyCreatedIssueToClipboard: true,
  linearIssueCodingAgent: 'claude-code',
  linearIssueCodingModel: '',
}

export interface Toast {
  id: string
  message: string
  type: 'error' | 'info' | 'warning'
  action?: { label: string; onClick: () => void }
}

export interface ConfirmDialogState {
  title: string
  message: string
  confirmLabel?: string
  destructive?: boolean
  tip?: string
  loading?: boolean
  onConfirm: () => void
  secondaryConfirmLabel?: string
  onSecondaryConfirm?: () => void
}

export interface ChatSnippet {
  text: string
  filePath?: string
  startLine?: number
  endLine?: number
}

export interface AppState {
  // Data
  projects: Project[]
  workspaces: Workspace[]
  tabs: Tab[]
  automations: Automation[]
  activeWorkspaceId: string | null
  activeTabId: string | null
  lastActiveTabByWorkspace: Record<string, string>
  rightPanelMode: RightPanelMode
  rightPanelOpen: boolean
  sidebarCollapsed: boolean
  /** Ephemeral: manually collapsed project sections in the left sidebar. */
  collapsedProjectIds: Set<string>
  /** Ephemeral: most recently active workspace per project for project hotkeys. */
  lastActiveWorkspaceByProjectId: Record<string, string>
  lastSavedTabId: string | null
  workspaceDialogProjectId: string | null
  settings: Settings
  settingsOpen: boolean
  automationsOpen: boolean
  linearPanelOpen: boolean
  confirmDialog: ConfirmDialogState | null
  toasts: Toast[]
  quickOpenVisible: boolean
  /** Linear fuzzy jump-to-issue/project dialog (⌘F when Linear panel is open). */
  linearQuickOpenVisible: boolean
  /** Fuzzy find over changed files (diff tab or Changes right panel). */
  changesFileFind: { worktreePath: string; paths: string[] } | null
  planPaletteVisible: boolean
  hunkReviewOpen: boolean
  hunkReviewWorkspaceId: string | null
  unreadWorkspaceIds: Set<string>
  activeClaudeWorkspaceIds: Set<string>
  prStatusMap: Map<string, PrInfo | null>
  ghAvailability: Map<string, boolean>
  gitFileStatuses: Map<string, Map<string, string>>
  workingTreeDiffSnapshots: Map<string, WorkingTreeDiffSnapshot>
  /** Per-workspace worktree sync status (key = workspace id) */
  worktreeSyncStatus: Map<string, WorkspaceSyncInfo>
  /** Graphite stack info per workspace (ephemeral; filled by poller). */
  graphiteStacks: Map<string, GraphiteStackInfo>
  graphiteStackExpanded: boolean
  /** Last seen `git ls-remote origin HEAD` hash per project (background poller) */
  lastKnownRemoteHead: Record<string, string>
  activeMonacoEditor: editor.IStandaloneCodeEditor | null
  /** Ephemeral: plan absolute path → terminal tab id from last Build (not persisted). */
  planBuildTerminalByPlanPath: Record<string, string>
  /** Ephemeral: context window usage for the active workspace's Claude Code session. */
  contextWindowData: ContextWindowData | null

  // Sidebar action order (persisted)
  sidebarActionOrder: SidebarActionId[]

  // Actions
  addProject: (project: Project) => void
  removeProject: (id: string) => void
  addWorkspace: (workspace: Workspace) => void
  removeWorkspace: (id: string) => void
  setActiveWorkspace: (id: string | null) => void
  addTab: (tab: Tab) => void
  removeTab: (id: string) => void
  setActiveTab: (id: string | null) => void
  /** Reorder tabs for a workspace; `orderedIds` must be a permutation of that workspace's tab ids. */
  reorderTabsInWorkspace: (workspaceId: string, orderedIds: string[]) => void
  setRightPanelMode: (mode: RightPanelMode) => void
  toggleRightPanel: () => void
  toggleSidebar: () => void
  toggleProjectCollapsed: (projectId: string) => void
  nextTab: () => void
  prevTab: () => void
  createTerminalForActiveWorkspace: () => Promise<void>
  /** Pi SDK agent thread (non-PTY); catalog under app userData. */
  createPiThreadForActiveWorkspace: () => Promise<void>
  /** Update bound Pi session for a PI Chat tab (multi-chat per worktree). */
  setPiThreadSessionBinding: (tabId: string, piSessionId: string, title?: string) => void
  /** Launch a new terminal tab with a pre-written command (plan builds, no session resume). */
  launchAgentTerminalWithCommand: (opts: {
    workspaceId: string
    worktreePath: string
    title: string
    command: string
    agentType: AgentType
  }) => Promise<string>
  /**
   * New worktree from the active project + terminal with the configured coding agent,
   * seeded with the Linear issue as the prompt.
   */
  startLinearIssueAgentSession: (issue: LinearIssueNode) => Promise<void>
  closeActiveTab: () => void
  setTabUnsaved: (tabId: string, unsaved: boolean) => void
  notifyTabSaved: (tabId: string) => void
  openFileTab: (filePath: string) => void
  openMarkdownPreview: (filePath: string) => void
  /**
   * Update every open surface that references an agent plan file (markdown preview tab, file tab,
   * file leaves in terminal splits) and migrate `planBuildTerminalByPlanPath` when the on-disk path changes.
   */
  retargetPlanFilePathEverywhere: (oldPath: string, newPath: string) => void
  /** Remember which terminal tab was spawned for a plan (⌘L routing). */
  setPlanBuildTerminalForPlan: (planPath: string, terminalTabId: string) => void
  /** Open newest .md/.mdx across agent plan dirs (.cursor/plans, etc.) in the active workspace */
  openLatestAgentPlan: () => Promise<void>
  openT3CodeTab: (workspaceId: string) => Promise<void>
  openDiffTab: (workspaceId: string) => void
  openCommitDiffTab: (workspaceId: string, hash: string, message: string) => void
  nextWorkspace: () => void
  prevWorkspace: () => void
  /** Next workspace in sidebar order within the active project only. */
  nextWorkspaceInActiveProject: () => void
  /** Previous workspace in sidebar order within the active project only. */
  prevWorkspaceInActiveProject: () => void
  switchToProjectByIndex: (index: number) => void
  switchToTabByIndex: (index: number) => void
  closeAllWorkspaceTabs: () => void
  focusOrCreateTerminal: () => Promise<void>
  splitTerminalPaneForTab: (tabId: string, direction: 'horizontal' | 'vertical') => Promise<void>
  splitTerminalPane: (direction: 'horizontal' | 'vertical') => Promise<void>
  openFileInSplit: (filePath: string, direction?: 'horizontal' | 'vertical') => Promise<void>
  cycleFocusedPane: () => void
  setFocusedPane: (tabId: string, paneId: string) => void
  closeSplitPane: (paneId: string) => void
  mergeTabIntoSplit: (sourceTabId: string, targetTabId: string, direction?: 'horizontal' | 'vertical') => void
  openWorkspaceDialog: (projectId: string | null) => void
  renameWorkspace: (id: string, name: string) => void
  reorderWorkspace: (fromId: string, toId: string) => void
  reorderProject: (fromId: string, toId: string) => void
  reorderSidebarAction: (fromId: SidebarActionId, toId: SidebarActionId) => void
  updateWorkspaceBranch: (id: string, branch: string) => void
  /** Re-scan `git worktree list` and merge missing linked worktrees into the sidebar. */
  refreshGitWorktrees: () => void
  deleteWorkspace: (workspaceId: string) => Promise<void>
  updateProject: (id: string, partial: Partial<Omit<Project, 'id'>>) => void
  deleteProject: (projectId: string) => Promise<void>
  updateSettings: (partial: Partial<Settings>) => void
  toggleSettings: () => void
  toggleAutomations: () => void
  toggleLinear: () => void
  showConfirmDialog: (dialog: ConfirmDialogState) => void
  updateConfirmDialog: (partial: Partial<ConfirmDialogState>) => void
  dismissConfirmDialog: () => void
  addToast: (toast: Toast) => void
  dismissToast: (id: string) => void
  toggleQuickOpen: () => void
  closeQuickOpen: () => void
  /** Open Linear fuzzy search dialog; no-op if Linear panel is closed. */
  openLinearQuickOpen: () => void
  closeLinearQuickOpen: () => void
  openChangesFileFind: (payload: { worktreePath: string; paths: string[] }) => void
  closeChangesFileFind: () => void
  togglePlanPalette: () => void
  closePlanPalette: () => void
  toggleHunkReview: () => Promise<void>
  closeHunkReview: () => void
  submitHunkReview: (selectedCommentIds?: Set<string>) => Promise<void>

  // Add to Chat actions
  setActiveMonacoEditor: (editor: editor.IStandaloneCodeEditor | null) => void
  getFirstAgentTerminalPtyId: () => string | undefined
  sendContextToAgent: (snippets: ChatSnippet[]) => void

  // Unread indicator actions
  markWorkspaceUnread: (workspaceId: string) => void
  clearWorkspaceUnread: (workspaceId: string) => void

  // Agent activity actions (Claude + Codex + Gemini + Cursor)
  setActiveAgentWorkspaces: (entries: { wsId: string; agentType: string }[]) => void
  setTerminalAgentType: (ptyId: string, agentType: AgentType) => void
  updateTerminalTitle: (ptyId: string, title: string) => void

  // Git file status actions
  setGitFileStatuses: (worktreePath: string, statuses: Map<string, string>) => void
  updateGitStatusSnapshot: (worktreePath: string, snapshot: GitStatusSnapshot) => void
  setWorkingTreeDiffSnapshot: (worktreePath: string, snapshot: WorkingTreeDiffSnapshot | null) => void
  setTabDeleted: (tabId: string, deleted: boolean) => void

  // Sync actions
  setLastKnownRemoteHead: (projectId: string, hash: string) => void

  // PR status actions
  setPrStatuses: (projectId: string, statuses: Record<string, PrInfo | null>) => void
  setGhAvailability: (projectId: string, available: boolean) => void
  setWorktreeSyncStatus: (projectId: string, workspaces: Record<string, WorkspaceSyncInfo>) => void
  setGraphiteStack: (workspaceId: string, stack: GraphiteStackInfo | null) => void
  toggleGraphiteStackExpanded: () => void
  setContextWindowData: (data: ContextWindowData | null) => void

  // Automation actions
  addAutomation: (automation: Automation) => void
  updateAutomation: (id: string, partial: Partial<Omit<Automation, 'id'>>) => void
  removeAutomation: (id: string) => void

  // Skills & Subagents actions
  addSkill: (skill: SkillEntry) => void
  removeSkill: (id: string) => void
  updateSkill: (id: string, partial: Partial<Omit<SkillEntry, 'id'>>) => void
  addSubagent: (subagent: SubagentEntry) => void
  removeSubagent: (id: string) => void
  updateSubagent: (id: string, partial: Partial<Omit<SubagentEntry, 'id'>>) => void

  // Hydration
  hydrateState: (data: PersistedState) => void

  // Derived
  activeWorkspaceTabs: () => Tab[]
  activeProject: () => Project | undefined
  visibleProjects: () => Project[]
  visibleWorkspaces: () => Workspace[]
  resolveProjectTargetWorkspace: (projectId: string) => Workspace | undefined
}

export type SidebarActionId = 'add-project' | 'automations' | 'linear' | 'plans' | 'settings' | 'review'

export const DEFAULT_SIDEBAR_ACTION_ORDER: SidebarActionId[] = [
  'add-project',
  'automations',
  'linear',
  'plans',
  'review',
  'settings',
]

export interface PersistedState {
  projects: Project[]
  workspaces: Workspace[]
  tabs?: Tab[]
  automations?: Automation[]
  activeWorkspaceId?: string | null
  activeTabId?: string | null
  lastActiveTabByWorkspace?: Record<string, string>
  settings?: Settings
  sidebarActionOrder?: SidebarActionId[]
}
