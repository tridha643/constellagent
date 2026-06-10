import type { editor } from 'monaco-editor'
import type { ServiceStatus } from '@shared/service-types'
import type { LinearIssueNode } from '../linear/linear-api'
import type { LinkedPullRequest, PrInfo } from '@shared/github-types'
import type { GithubRepoInfo } from '@shared/github-url'
import type { WorkspaceBarStats } from '@shared/git-types'
import type { WorkspaceSyncInfo } from '@shared/worktree-sync-types'
import type { ContextWindowData } from '@shared/context-window-types'
import type { UsageLimitsData } from '@shared/usage-limits-types'
import type { AutomationAction, AutomationTrigger, AutomationRunStatus } from '../../shared/automation-types'
import type { WorktreeCredentialRule } from '../../shared/worktree-credentials'
import type { GraphiteStackInfo } from '../../shared/graphite-types'
import type { ComposioAutomationLink, ComposioWebhookSettings } from '../../shared/composio-types'
import type { SpotlightStatus } from '../../shared/spotlight-types'
import type { AppearanceThemeId } from '../theme/appearance'
import type { EditorLanguageOverride } from '../utils/language-map'
import type { GitStatusSnapshot, WorkingTreeDiffSnapshot, WorkingTreeFileStatus } from '../types/working-tree-diff'
import { getDefaultWorktreeCredentialRules } from '../../shared/worktree-credentials'
import type { AgentProvider } from '../../shared/agent-chat-types'
import type { ThinkingLevel } from '../../shared/conductor-thinking'
import type { TerminalSessionBackend, TerminalSessionStatus } from '../../shared/terminal-session-types'
import type { AgentationEvent, AgentationSession, AgentationStatus } from '../../shared/agentation-types'
import {
  DEFAULT_CONDUCTOR_PROVIDER,
  defaultConductorModel,
  normalizeConductorDefaultModel,
  normalizeConductorDefaultProvider,
  normalizeConductorDefaultThinkingLevel,
} from '../../shared/conductor-model-utils'
import {
  DEFAULT_CODEX_WEBSOCKETS_SETTING,
  normalizeCodexWebSocketsSetting,
  type CodexWebSocketsSetting,
} from '../../shared/codex-websockets'

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
  /** Optional Composio trigger instance linkage (API upsert). */
  composio?: ComposioAutomationLink
}

/** A single per-workspace todo in the Checks & Todos tab. Ordering = array order. */
export interface TodoItem {
  id: string
  text: string
  done: boolean
  createdAt: number
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

/**
 * Per-project icon override. Absent ⇒ resolve the GitHub owner avatar, then a
 * fallback glyph. `template` renders a bundled Lucide glyph tinted by a theme
 * accent; `custom` points at a PNG copied into userData (the `version` busts the
 * <img> cache when the file is replaced).
 */
export type ProjectIcon =
  | { type: 'template'; glyph: string; color: string }
  | { type: 'custom'; version: number }

export interface Project {
  id: string
  name: string
  repoPath: string
  startupCommands?: StartupCommand[]
  prLinkProvider?: PrLinkProvider
  /** Per-project icon override (template glyph or custom PNG). */
  icon?: ProjectIcon
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
  linkedPullRequest?: LinkedPullRequest
  /** Sticky manual override: when true this workspace holds its place in the Pinned section. */
  pinned?: boolean
  /** Hand-sort order within the Pinned section (ascending). Only meaningful when `pinned`. */
  pinOrder?: number
  /**
   * Manual override placing this workspace in a user-created {@link CustomSection}
   * (by id) instead of an auto status bucket. Mutually exclusive with `pinned`.
   * Ignored if no section with this id exists for the workspace's project.
   */
  sectionId?: string
  /**
   * Manual override forcing this workspace into a specific auto status bucket
   * regardless of its derived status (e.g. dropped into an empty "Active").
   * Mutually exclusive with `pinned` / `sectionId`. Mirrors the `WorkspaceBucket`
   * union in `sidebar-navigation.ts`.
   */
  bucketOverride?: 'needs-you' | 'in-review' | 'active' | 'idle'
  /** Wall-clock ms of the last selection/activity. Powers the Active/Idle split and intra-section ordering. */
  lastActiveAt?: number
}

/**
 * A user-created sidebar section ("manual section"). Workspaces opt in via
 * {@link Workspace.sectionId}; the section renders between Pinned and the auto
 * status buckets. Scoped to one project.
 */
export interface CustomSection {
  id: string
  projectId: string
  name: string
  /** Sort order among a project's custom sections (ascending). */
  order: number
  /** True for the seeded catch-all ("Non-priority"): absorbs unassigned workspaces and can't be deleted. */
  isDefault?: boolean
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
  | { type: 'file'; filePath: string; unsaved?: boolean; deleted?: boolean; splitRoot?: SplitNode; focusedPaneId?: string; initialPosition?: { lineNumber: number; column: number }; viewState?: editor.ICodeEditorViewState | null }
  | { type: 'diff' }
  | { type: 'fileDiff'; filePath: string; status?: WorkingTreeFileStatus['status']; originalRef?: string }
  | { type: 'markdownPreview'; filePath: string; title: string }
  /** Conductor agent chat (Cursor / Codex SDK); session lives in conductor-chat.db. */
  | { type: 'conductor'; title: string; agentSessionId?: string }
  /** Embedded webview with Agentation toolbar for localhost UI feedback. */
  | { type: 'browser'; title: string; url: string; sessionId?: string }
  // First-class long-running service (e.g. `bun dev`, `npm test`). Hosts a PTY just like
  // a terminal tab, but the user gets status + Restart/Stop controls instead of agent chrome.
  | { type: 'service'; title: string; ptyId: string; scriptName: string;
      command: string; status: ServiceStatus; exitCode?: number; persistKey?: string }
)

export type Side = 'left' | 'right'

export type PanelType = 'project' | 'files' | 'changes' | 'checks' | 'sideChat'

export type RightSidebarBottomPanel = 'setup' | 'terminal'

export interface SidePanelState {
  open: boolean
  activePanel: PanelType
  panelOrder: PanelType[]
}

export interface SidePanelLayout {
  left: SidePanelState
  right: SidePanelState
}

export const SIDE_PANEL_TYPES: PanelType[] = ['project', 'files', 'changes', 'checks', 'sideChat']

export const NAVIGATION_PANEL_TYPES: PanelType[] = ['files', 'changes']

export const DEFAULT_SIDE_PANEL_LAYOUT: SidePanelLayout = {
  left: {
    open: true,
    activePanel: 'project',
    panelOrder: ['project'],
  },
  right: {
    open: true,
    activePanel: 'files',
    panelOrder: ['files', 'changes', 'checks', 'sideChat'],
  },
}

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

/** Linear panel main view: kanban dashboard, issues list, projects grid, tickets composer, or project updates composer. */
export type LinearWorkspaceView =
  | 'dashboard'
  | 'issues'
  | 'projects'
  | 'tickets'
  | 'updates'

export type LinearWorkspaceTab = LinearWorkspaceView

const LINEAR_WORKSPACE_TAB_ORDER_DEFAULT: LinearWorkspaceTab[] = [
  'dashboard',
  'issues',
  'projects',
  'tickets',
  'updates',
]

function isLinearWorkspaceTab(v: unknown): v is LinearWorkspaceTab {
  return (
    v === 'dashboard' ||
    v === 'issues' ||
    v === 'projects' ||
    v === 'tickets' ||
    v === 'updates'
  )
}

export function normalizeLinearWorkspaceView(v: unknown): LinearWorkspaceView {
  if (isLinearWorkspaceTab(v)) return v
  return 'dashboard'
}

/** Persisted order of the Linear workspace pill. Drops unknowns; appends any missing tab ids so forward-migrations (new tabs) never disappear. */
export function normalizeLinearWorkspaceTabOrder(v: unknown): LinearWorkspaceTab[] {
  const all = LINEAR_WORKSPACE_TAB_ORDER_DEFAULT
  if (!Array.isArray(v)) return [...all]
  const seen = new Set<string>()
  const out: LinearWorkspaceTab[] = []
  for (const x of v) {
    if (isLinearWorkspaceTab(x)) {
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

/**
 * Client-side filter on fetched issues: Linear priority 1–4, or all.
 * @deprecated Use `linearIssueFilters.priorities` instead. Kept for one release for forward migration; new code should read/write the filters object.
 */
export type LinearIssuesPriorityPreset = 'all' | '1' | '2' | '3' | '4'

/** @deprecated See {@link LinearIssuesPriorityPreset}. */
export function normalizeLinearIssuesPriorityPreset(
  v: unknown,
): LinearIssuesPriorityPreset {
  if (v === 'all' || v === '1' || v === '2' || v === '3' || v === '4') return v
  return 'all'
}

/**
 * Linear issue state-type buckets we render as groups.
 * Values match Linear API `state.type` strings so incoming issues slot in without mapping tables.
 */
export const LINEAR_ISSUE_STATE_TYPES = [
  'started',
  'unstarted',
  'backlog',
  'triage',
  'completed',
  'canceled',
] as const

export type LinearIssueStateType = (typeof LINEAR_ISSUE_STATE_TYPES)[number]

export function isLinearIssueStateType(v: unknown): v is LinearIssueStateType {
  return (
    typeof v === 'string' &&
    (LINEAR_ISSUE_STATE_TYPES as readonly string[]).includes(v)
  )
}

/** Density options for the grouped Issues list. */
export type LinearIssueDensity = 'compact' | 'comfortable'

export function normalizeLinearIssueDensity(v: unknown): LinearIssueDensity {
  if (v === 'compact' || v === 'comfortable') return v
  return 'comfortable'
}

/** Multi-select client-side filter state for the Issues list. */
export interface LinearIssueFilters {
  /** Linear priority numerics: 0 (none), 1 (urgent), 2, 3, 4 (low). Empty = all priorities. */
  priorities: number[]
  /** Subset of {@link LINEAR_ISSUE_STATE_TYPES}. Empty = all states. */
  stateTypes: LinearIssueStateType[]
  /** Team keys (`team.key`). Empty = all teams. */
  teamKeys: string[]
  /** Free-text search (title + identifier). */
  text: string
}

export const EMPTY_LINEAR_ISSUE_FILTERS: LinearIssueFilters = Object.freeze({
  priorities: [],
  stateTypes: [],
  teamKeys: [],
  text: '',
}) as LinearIssueFilters

export function normalizeLinearIssueFilters(v: unknown): LinearIssueFilters {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const priorities = Array.isArray(src.priorities)
    ? Array.from(
        new Set(
          (src.priorities as unknown[])
            .map((p) => Number(p))
            .filter((n) => n === 0 || n === 1 || n === 2 || n === 3 || n === 4),
        ),
      )
    : []
  const stateTypes = Array.isArray(src.stateTypes)
    ? Array.from(
        new Set(
          (src.stateTypes as unknown[]).filter(isLinearIssueStateType),
        ),
      )
    : []
  const teamKeys = Array.isArray(src.teamKeys)
    ? Array.from(
        new Set(
          (src.teamKeys as unknown[]).filter(
            (t): t is string => typeof t === 'string' && t.length > 0,
          ),
        ),
      )
    : []
  const text = typeof src.text === 'string' ? src.text : ''
  return { priorities, stateTypes, teamKeys, text }
}

export function normalizeLinearIssueStateGroupsCollapsed(
  v: unknown,
): LinearIssueStateType[] {
  if (!Array.isArray(v)) return []
  return Array.from(new Set(v.filter(isLinearIssueStateType)))
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

export type LinearIssueLaunchTarget = 'terminal' | 'conductor'

export function normalizeLinearIssueLaunchTarget(v: unknown): LinearIssueLaunchTarget {
  return v === 'conductor' ? 'conductor' : 'terminal'
}

export function normalizeLinearIssueConductorProvider(v: unknown): AgentProvider {
  return normalizeConductorDefaultProvider(v)
}

export function normalizeLinearIssueConductorModel(v: unknown): string {
  return normalizeConductorDefaultModel(v)
}

export function normalizeLinearIssueConductorThinkingLevel(v: unknown): ThinkingLevel {
  return normalizeConductorDefaultThinkingLevel(v) ?? 'medium'
}

export function normalizeConflictResolverAgent(v: unknown): AgentType {
  if (typeof v === 'string' && (LINEAR_ISSUE_CODING_AGENTS as readonly string[]).includes(v)) {
    return v as AgentType
  }
  return 'claude-code'
}

export function normalizeConflictResolverModel(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function normalizeConductorDefaultProviderSetting(v: unknown): AgentProvider {
  return normalizeConductorDefaultProvider(v)
}

export function normalizeConductorDefaultModelSetting(v: unknown): string {
  return normalizeConductorDefaultModel(v)
}

export function normalizeConductorDefaultThinkingLevelSetting(v: unknown): ThinkingLevel {
  return normalizeConductorDefaultThinkingLevel(v) ?? 'medium'
}

export function normalizeConductorCodexWebSocketsSetting(v: unknown): CodexWebSocketsSetting {
  return normalizeCodexWebSocketsSetting(v)
}

/** Pi model id for commit/PR-adjacent generation; empty means app default (composer-2-fast). */
export function normalizePiCommitMessageModel(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.trim()
}

export type SettingsSectionId =
  | 'appearance'
  | 'sidebar'
  | 'general'
  | 'linear'
  | 'conductor'
  | 'mcp'
  | 'integrations'
  | 'composio'
  | 'mobile'
  | 'worktree'
  | 'skills'
  | 'shortcuts'

export interface Settings {
  appearanceThemeId: AppearanceThemeId
  confirmOnClose: boolean
  autoSaveOnBlur: boolean
  defaultShell: string
  restoreWorkspace: boolean
  /** Play a short chime when an agent in a background workspace completes or fails. */
  playAgentDoneChime: boolean
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
  /** When true, the Cmd+F Quick Open palette also greps file contents via fff and shows code matches alongside file-name matches. */
  quickOpenCodeSearchEnabled: boolean
  /** Linear Personal API key (Settings only; persisted in app state JSON). */
  linearApiKey: string
  /** Cursor API key for Conductor (Cursor SDK). Falls back to CURSOR_API_KEY in the environment. */
  conductorCursorApiKey: string
  /** OpenAI API key for Conductor (Codex SDK). Falls back to OPENAI_API_KEY or `codex login`. */
  conductorOpenaiApiKey: string
  /** Starting provider for new unsent Conductor chats. */
  conductorDefaultProvider: AgentProvider
  /** Starting model for new unsent Conductor chats. */
  conductorDefaultModel: string
  /** Starting reasoning effort for new unsent Conductor chats. */
  conductorDefaultThinkingLevel: ThinkingLevel
  /** Codex SDK transport preference; auto only enables WebSockets for eligible Codex models. */
  conductorCodexWebSockets: CodexWebSocketsSetting
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
  /**
   * Default priority filter for the Issues list (client-side).
   * @deprecated Use {@link Settings.linearIssueFilters}. Kept for persisted-state migration; read as a seed for `linearIssueFilters.priorities` once, then frozen at `'all'`.
   */
  linearIssuesPriorityPreset: LinearIssuesPriorityPreset
  /** Multi-select client-side filters for the Issues list (priority, state, team, search). */
  linearIssueFilters: LinearIssueFilters
  /** Density of Issue rows. */
  linearIssueDensity: LinearIssueDensity
  /** State-type buckets whose group is collapsed in the Issues list. */
  linearIssueStateGroupsCollapsed: LinearIssueStateType[]
  /** Copy created Linear issue URLs to the clipboard from the Tickets composer success flow. */
  linearCopyCreatedIssueToClipboard: boolean
  /** Coding agent CLI when opening a Linear issue in a new worktree (Issues row / Tickets toast). */
  linearIssueCodingAgent: AgentType
  /**
   * Model passed to the agent CLI (`--model`). Empty = omit flag (CLI default).
   * Value can be a preset id or custom string (same as plan build).
   */
  linearIssueCodingModel: string
  /** Surface that opens after creating a worktree from a Linear issue. */
  linearIssueLaunchTarget: LinearIssueLaunchTarget
  /** When true, Linear Conductor launches reuse global Conductor defaults. */
  linearIssueConductorUseDefaults: boolean
  /** Override Conductor provider for Linear launches when useDefaults is false. */
  linearIssueConductorProvider: AgentProvider
  /** Override Conductor model for Linear launches when useDefaults is false. */
  linearIssueConductorModel: string
  /** Override reasoning effort for Linear Conductor launches when useDefaults is false. */
  linearIssueConductorThinkingLevel: ThinkingLevel
  /** Start Linear Conductor sessions in plan mode. */
  linearIssueConductorPlan: boolean
  /** Start Linear Conductor sessions in canvas mode. */
  linearIssueConductorCanvas: boolean
  /** Close Linear overlay after launching from an issue. */
  linearIssueClosePanelOnLaunch: boolean
  /**
   * CLI launched when `git push` after a commit hits a non-fast-forward and the auto fetch+rebase
   * runs into content conflicts. The agent resolves the rebase mid-flight; the user re-clicks Commit
   * to push.
   */
  conflictResolverAgent: AgentType
  /** `--model` passed to the conflict-resolver CLI. Empty = omit flag (CLI default). */
  conflictResolverModel: string
  /**
   * Pi CLI `--model` for AI-generated commit summaries (Changes panel, branch+PR popover).
   * GitHub `gh pr create --fill` uses commit messages as PR title/body. Empty = composer-2-fast.
   */
  piCommitMessageModel: string
  /** Last-used parent directory in the Add Project → Clone from GitHub flow. Pre-fills the picker on next use. */
  lastClonedParentDir?: string
  /** Optional override for the Agentation HTTP/SSE endpoint (empty = embedded server). */
  agentationEndpoint: string
}

export const DEFAULT_SETTINGS: Settings = {
  appearanceThemeId: 'default',
  confirmOnClose: true,
  autoSaveOnBlur: false,
  defaultShell: '',
  restoreWorkspace: true,
  playAgentDoneChime: true,
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
  quickOpenCodeSearchEnabled: false,
  linearApiKey: '',
  conductorCursorApiKey: '',
  conductorOpenaiApiKey: '',
  conductorDefaultProvider: DEFAULT_CONDUCTOR_PROVIDER,
  conductorDefaultModel: defaultConductorModel(DEFAULT_CONDUCTOR_PROVIDER),
  conductorDefaultThinkingLevel: 'medium',
  conductorCodexWebSockets: DEFAULT_CODEX_WEBSOCKETS_SETTING,
  linearProjectUpdateBar: [],
  linearFavoriteProjectIds: [],
  linearWorkspaceToolbarTool: 'search',
  linearWorkspaceView: 'dashboard',
  linearWorkspaceTabOrder: ['dashboard', 'issues', 'projects', 'tickets', 'updates'],
  linearIssueScope: 'assigned',
  linearIssuesPriorityPreset: 'all',
  linearIssueFilters: { priorities: [], stateTypes: [], teamKeys: [], text: '' },
  linearIssueDensity: 'comfortable',
  linearIssueStateGroupsCollapsed: ['completed', 'canceled'],
  linearCopyCreatedIssueToClipboard: true,
  linearIssueCodingAgent: 'claude-code',
  linearIssueCodingModel: '',
  linearIssueLaunchTarget: 'terminal',
  linearIssueConductorUseDefaults: true,
  linearIssueConductorProvider: DEFAULT_CONDUCTOR_PROVIDER,
  linearIssueConductorModel: defaultConductorModel(DEFAULT_CONDUCTOR_PROVIDER),
  linearIssueConductorThinkingLevel: 'medium',
  linearIssueConductorPlan: true,
  linearIssueConductorCanvas: false,
  linearIssueClosePanelOnLaunch: true,
  conflictResolverAgent: 'claude-code',
  conflictResolverModel: '',
  piCommitMessageModel: '',
  agentationEndpoint: '',
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
  confirmInPlace?: boolean
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

export interface ReviewPanelPersistedState {
  reviewMode: 'annotations' | 'tour'
  activeTourStepId: string | null
  activeFile: string | null
  visibleCount: number
  /** Set<string> of viewed file paths, serialized as a sorted array. */
  viewedFilePaths: string[]
  /** Selected human comment ids in the review submission selection. */
  selectedIds: string[]
}

export interface SideTerminalSession {
  id: string
  workspaceId: string
  backend: TerminalSessionBackend
  sessionName?: string
  clientPtyId?: string
  title: string
  status: TerminalSessionStatus
  createdAt: number
  lastAttachedAt?: number
  error?: string
}

export interface AppState {
  // Data
  projects: Project[]
  workspaces: Workspace[]
  /** User-created manual sidebar sections (per project). */
  customSections: CustomSection[]
  tabs: Tab[]
  automations: Automation[]
  activeWorkspaceId: string | null
  activeTabId: string | null
  lastActiveTabByWorkspace: Record<string, string>
  sidePanels: SidePanelLayout
  /** Per-workspace overrides for `sidePanels`. Falls back to the global `sidePanels`
   *  when no entry exists for a workspace yet. */
  sidePanelsByWorkspace: Record<string, SidePanelLayout>
  /** Per-workspace HunkReview floating panel width override. */
  hunkReviewWidthByWorkspace: Record<string, number>
  /** Per-workspace expanded folder paths in the file tree. */
  fileTreeExpandedPathsByWorkspace: Record<string, string[]>
  /** Per-workspace HunkReview UI state (mode, active file, scroll, selection). */
  reviewPanelStateByWorkspace: Record<string, ReviewPanelPersistedState>
  /** Per-workspace staged-file selection in the right-panel Changes view. */
  stagedSelectionByWorkspace: Record<string, string[]>
  /** Per-workspace user todo lists (Checks & Todos tab). Persisted. */
  workspaceTodos: Record<string, TodoItem[]>
  /** Per-workspace tmux-backed side terminal sessions. Client PTY ids are ephemeral. */
  sideTerminalsByWorkspace: Record<string, SideTerminalSession[]>
  /** Bottom dock inside the right sidebar, separate from the top panel mode switcher. */
  rightSidebarBottomPanel: RightSidebarBottomPanel
  /** Ephemeral: manually collapsed project sections in the project navigation panel. */
  collapsedProjectIds: Set<string>
  /** Persisted: collapsed sidebar status sections, keyed `${projectId}:${sectionId}`. Absent = expanded. */
  collapsedSidebarSections: Record<string, boolean>
  /** Ephemeral: most recently active workspace per project for project hotkeys. */
  lastActiveWorkspaceByProjectId: Record<string, string>
  lastSavedTabId: string | null
  workspaceDialogProjectId: string | null
  settings: Settings
  /** Composio webhook receiver settings (persisted alongside app state). */
  composioWebhook: ComposioWebhookSettings
  settingsOpen: boolean
  settingsSection: SettingsSectionId
  automationsOpen: boolean
  linearPanelOpen: boolean
  /** Latest connection status of the embedded Agentation HTTP server. Null until first probe. */
  agentationStatus: AgentationStatus | null
  /** Live annotation sessions streamed from agentation-mcp (newest activity first). */
  agentationSessions: AgentationSession[]
  /**
   * Pending composer prefill keyed by Conductor tab id. Consumed (and cleared)
   * when the Conductor chat view mounts/focuses. Used by the Agentation "Send"
   * fallback when no agent terminal is available (D5b). Not persisted.
   */
  pendingComposerDraftByTab: Record<string, string>
  confirmDialog: ConfirmDialogState | null
  toasts: Toast[]
  quickOpenVisible: boolean
  /**
   * Set when Cmd+F was pressed from inside a focused Monaco file editor. When
   * present, QuickOpen pins its code search scope to this file (fff activeFile
   * scope) regardless of the settings.quickOpenCodeSearchEnabled toggle. Null
   * for the default worktree-wide entry.
   */
  editorFindContext: { filePath: string } | null
  /**
   * One-shot initial query consumed by QuickOpen on mount. Set by
   * openQuickOpenFromEditor so the editor's current selection seeds the input.
   * Cleared on palette close.
   */
  quickOpenInitialQuery: string | null
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
  /** Resolved default branch per project id (`git symbolic-ref refs/remotes/origin/HEAD`). */
  defaultBranchByProjectId: Map<string, string>
  /**
   * Resolved GitHub `{ owner, name }` per project id for the sidebar avatar + header.
   * `null` means resolved-but-not-GitHub (name fallback); absent means not yet looked up.
   */
  repoInfoByProjectId: Map<string, GithubRepoInfo | null>
  /** Local-mode workspace bar stats keyed by workspace id (commit subject + working-tree-inclusive numstat). */
  workspaceBarStatsMap: Map<string, WorkspaceBarStats>
  gitFileStatuses: Map<string, Map<string, string>>
  workingTreeDiffSnapshots: Map<string, WorkingTreeDiffSnapshot>
  /** Per-workspace worktree sync status (key = workspace id) */
  worktreeSyncStatus: Map<string, WorkspaceSyncInfo>
  /** Graphite stack info per workspace (ephemeral; filled by poller). */
  graphiteStacks: Map<string, GraphiteStackInfo>
  graphiteStackExpanded: boolean
  /**
   * Persisted: which workspace (if any) is spotlighting into each project's repo root.
   * Map<projectId, workspaceId | null>. Multiple projects can each spotlight independently.
   */
  spotlightWorkspaceIdByProject: Record<string, string | null>
  /** Ephemeral live status broadcast from `SpotlightService`, keyed by projectId. */
  spotlightStatusByProject: Map<string, SpotlightStatus>
  /** Last seen `git ls-remote origin HEAD` hash per project (background poller) */
  lastKnownRemoteHead: Record<string, string>
  activeMonacoEditor: editor.IStandaloneCodeEditor | null
  /** Ephemeral: plan absolute path → terminal tab id from last Build (not persisted). */
  planBuildTerminalByPlanPath: Record<string, string>
  /** Ephemeral: context window usage for the active workspace's Claude Code session. */
  contextWindowData: ContextWindowData | null
  /** Ephemeral: Codex/Cursor account rate limits for Conductor composer hover popover. */
  usageLimitsData: UsageLimitsData | null

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
  setSidePanelActive: (side: Side, panel: PanelType) => void
  activatePanel: (panel: PanelType) => void
  movePanelToSide: (panel: PanelType, side: Side) => void
  resetSidePanelLayout: () => void
  setProjectPanelSide: (side: Side) => void
  setNavigationPanelSide: (side: Side) => void
  swapSidebarRoles: () => void
  toggleSidePanel: (side: Side) => void
  /** Open or close a physical sidebar host (used by Allotment snap + shortcuts). */
  setSidePanelOpen: (side: Side, open: boolean) => void
  toggleRightPanel: () => void
  toggleSidebar: () => void
  toggleProjectCollapsed: (projectId: string) => void
  nextTab: () => void
  prevTab: () => void
  createTerminalForActiveWorkspace: () => Promise<void>
  /** Launch a long-running service (package.json script or custom command) as a first-class tab. */
  createServiceForActiveWorkspace: (opts: { scriptName: string; command: string }) => Promise<void>
  /** Kill the old PTY and spawn a new one for the same service tab; keeps tab id, swaps ptyId. */
  restartService: (tabId: string) => Promise<void>
  /** Send SIGTERM via pty.destroy; PTY_EXIT broadcast flips status to exited. */
  stopService: (tabId: string) => void
  /** New draft Conductor tab in the active worktree (sidebar button / ⇧⌘C). */
  createConductorTabForActiveWorkspace: () => void
  createBrowserTabForActiveWorkspace: () => void
  setBrowserTabUrl: (tabId: string, url: string) => void
  setBrowserTabSessionId: (tabId: string, sessionId: string | undefined) => void
  /** Bind a Conductor tab to an agent-chat session after first submit or fork. */
  setConductorTabSessionBinding: (tabId: string, agentSessionId: string, title?: string) => void
  /** Open a Conductor tab for an existing session (e.g. fork). */
  openConductorSessionTab: (agentSessionId: string, title?: string) => void
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
  openFileTab: (filePath: string, opts?: { initialPosition?: { lineNumber: number; column: number } }) => void
  /** Clear the ephemeral initialPosition on a file tab once Monaco has consumed it. */
  clearFileTabInitialPosition: (tabId: string) => void
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
  openDiffTab: (workspaceId: string) => void
  /** Todo actions, all keyed by workspaceId. */
  addTodo: (workspaceId: string, text: string) => void
  renameTodo: (workspaceId: string, todoId: string, text: string) => void
  toggleTodo: (workspaceId: string, todoId: string) => void
  removeTodo: (workspaceId: string, todoId: string) => void
  /** Rewrite the todo array order for a workspace (drag-reorder). */
  reorderTodos: (workspaceId: string, orderedIds: string[]) => void
  clearCompletedTodos: (workspaceId: string) => void
  /** Open a VS Code-style full-file diff tab for a single file (HEAD vs working tree). */
  openFullFileDiffTab: (filePath: string, opts?: { status?: WorkingTreeFileStatus['status']; originalRef?: string }) => void
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
  focusOrCreateSideTerminal: () => Promise<void>
  createSideTerminalForActiveWorkspace: (options?: { title?: string; initialCommand?: string }) => Promise<void>
  attachSideTerminal: (workspaceId: string, terminalId: string) => Promise<void>
  detachSideTerminal: (workspaceId: string, terminalId: string) => void
  killSideTerminalSession: (workspaceId: string, terminalId: string) => Promise<void>
  reconcileSideTerminalsForWorkspace: (workspaceId: string) => Promise<void>
  handleSideTerminalClientExit: (ptyId: string) => void
  setRightSidebarBottomPanel: (panel: RightSidebarBottomPanel) => void
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

  // Sidebar pin actions (manual override of the auto-by-status sections)
  /** Pin a workspace into the Pinned section; assigns `pinOrder = max(existing)+1`. */
  pinWorkspace: (workspaceId: string) => void
  /** Return a workspace to auto placement (clears `pinned`/`pinOrder`). */
  unpinWorkspace: (workspaceId: string) => void
  togglePinWorkspace: (workspaceId: string) => void
  /** Reorder within the Pinned section; `beforeWorkspaceId` undefined = move to end. Pins the workspace if unpinned. */
  movePinnedWorkspaceBefore: (workspaceId: string, beforeWorkspaceId?: string) => void
  /** Stamp `lastActiveAt = Date.now()` on a workspace (powers Active/Idle + ordering). */
  touchWorkspaceActivity: (workspaceId: string) => void
  /** Collapse/expand a sidebar status section, keyed by `${projectId}:${sectionId}`. */
  toggleSidebarSectionCollapsed: (projectId: string, sectionId: string) => void

  // Manual (custom) sidebar sections
  /** Create a manual section in a project; returns its new id. `order` appends to the end. */
  createCustomSection: (projectId: string, name: string) => string
  /** Rename a manual section. Blank names are ignored. */
  renameCustomSection: (sectionId: string, name: string) => void
  /** Delete a manual section; its members revert to auto placement (`sectionId` cleared). */
  deleteCustomSection: (sectionId: string) => void
  /** Reorder a project's manual sections (move `fromId` to `toId`'s slot). */
  reorderCustomSection: (fromId: string, toId: string) => void
  /** Place a workspace in a manual section (clears `pinned`/bucket override), or `null` to return it to auto. */
  assignWorkspaceToSection: (workspaceId: string, sectionId: string | null) => void
  /** Force a workspace into a specific auto bucket (clears `pinned`/`sectionId`), or `null` to return it to derived status. */
  setWorkspaceBucketOverride: (
    workspaceId: string,
    bucket: 'needs-you' | 'in-review' | 'active' | 'idle' | null,
  ) => void
  /** Clear every manual placement override (pin, custom section, bucket) — return a workspace to pure auto. */
  resetWorkspacePlacement: (workspaceId: string) => void
  updateWorkspaceBranch: (id: string, branch: string) => void
  /** Re-scan `git worktree list` and merge missing linked worktrees into the sidebar. */
  refreshGitWorktrees: () => void
  deleteWorkspace: (workspaceId: string) => Promise<void>
  updateProject: (id: string, partial: Partial<Omit<Project, 'id'>>) => void
  deleteProject: (projectId: string) => Promise<void>
  updateSettings: (partial: Partial<Settings>) => void
  updateComposioWebhook: (partial: Partial<ComposioWebhookSettings>) => void
  toggleSettings: () => void
  setSettingsSection: (section: SettingsSectionId) => void
  openSettingsSection: (section: SettingsSectionId) => void
  toggleAutomations: () => void
  toggleLinear: () => void
  showConfirmDialog: (dialog: ConfirmDialogState) => void
  updateConfirmDialog: (partial: Partial<ConfirmDialogState>) => void
  dismissConfirmDialog: () => void
  addToast: (toast: Toast) => void
  dismissToast: (id: string) => void
  toggleQuickOpen: () => void
  closeQuickOpen: () => void
  /**
   * Open QuickOpen in editor-find mode. Pins codeSearch scope to `filePath`
   * (active file only, fff disk-based) and seeds the query with `initialQuery`.
   */
  openQuickOpenFromEditor: (payload: { filePath: string; initialQuery?: string }) => void
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

  // Agentation actions
  /** Probe status + reload the full session list from main (initial load + Retry). Never throws. */
  refreshAgentation: () => Promise<void>
  /** Replace the full session list (initial load from main). */
  setAgentationSessions: (sessions: AgentationSession[]) => void
  /** Apply a forwarded SSE/status event to the store (used by useAgentationEvents). */
  applyAgentationEvent: (event: AgentationEvent) => void
  /** Route an annotation's markdown to an agent (terminal PTY first, else Conductor composer). Closes the panel. */
  sendAgentationAnnotation: (markdown: string) => void
  /** Resolve an annotation back to Agentation (PATCH via main). */
  resolveAgentationAnnotation: (annotationId: string) => Promise<{ ok: boolean; error?: string }>
  /** Dismiss an annotation back to Agentation (PATCH via main). */
  dismissAgentationAnnotation: (annotationId: string) => Promise<{ ok: boolean; error?: string }>
  /** Stage a composer prefill for a Conductor tab (consumed on mount/focus). */
  setPendingComposerDraft: (tabId: string, draft: string) => void
  /** Read + clear a tab's pending composer prefill (returns '' if none). */
  consumePendingComposerDraft: (tabId: string) => string

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
  setProjectDefaultBranch: (projectId: string, branch: string) => void
  /** Cache resolved GitHub repo info (or `null` for non-GitHub) per project. */
  setProjectRepoInfo: (projectId: string, info: GithubRepoInfo | null) => void
  /** Update local-mode workspace bar stats for a workspace (dirty-checked). */
  setWorkspaceBarStats: (workspaceId: string, stats: WorkspaceBarStats) => void
  setWorktreeSyncStatus: (projectId: string, workspaces: Record<string, WorkspaceSyncInfo>) => void
  /** Persist which workspace is spotlighting into a project's repo root (null = none). */
  setSpotlightWorkspace: (projectId: string, workspaceId: string | null) => void
  /** Merge a live SpotlightStatus broadcast into `spotlightStatusByProject`. */
  setSpotlightStatus: (status: SpotlightStatus) => void
  setGraphiteStack: (workspaceId: string, stack: GraphiteStackInfo | null) => void
  toggleGraphiteStackExpanded: () => void
  setContextWindowData: (data: ContextWindowData | null) => void
  setUsageLimitsData: (data: UsageLimitsData | null) => void

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

  // Per-workspace UI persistence setters
  setSidePanelsForWorkspace: (workspaceId: string, layout: SidePanelLayout) => void
  setHunkReviewWidth: (workspaceId: string, widthPx: number | undefined) => void
  setFileTreeExpandedPaths: (workspaceId: string, paths: string[]) => void
  setReviewPanelState: (
    workspaceId: string,
    partial: Partial<ReviewPanelPersistedState>,
  ) => void
  setStagedSelection: (workspaceId: string, paths: string[]) => void
  setFileTabViewState: (tabId: string, viewState: editor.ICodeEditorViewState | null) => void

  // Hydration
  hydrateState: (data: PersistedState) => void

  // Derived
  activeWorkspaceTabs: () => Tab[]
  activeProject: () => Project | undefined
  visibleProjects: () => Project[]
  visibleWorkspaces: () => Workspace[]
  resolveProjectTargetWorkspace: (projectId: string) => Workspace | undefined
}

export type SidebarActionId = 'add-project' | 'conductor' | 'automations' | 'linear' | 'browser' | 'plans' | 'settings' | 'review'

export const DEFAULT_SIDEBAR_ACTION_ORDER: SidebarActionId[] = [
  'add-project',
  'conductor',
  'automations',
  'linear',
  'browser',
  'plans',
  'review',
  'settings',
]

export interface PersistedState {
  projects: Project[]
  workspaces: Workspace[]
  /** User-created manual sidebar sections (per project). */
  customSections?: CustomSection[]
  /** Legacy: removed Folder entity. Read only by the one-time pin migration in hydrateState. */
  folders?: unknown[]
  tabs?: Tab[]
  automations?: Automation[]
  activeWorkspaceId?: string | null
  activeTabId?: string | null
  lastActiveTabByWorkspace?: Record<string, string>
  settings?: Settings
  sidePanels?: SidePanelLayout
  sidePanelsByWorkspace?: Record<string, SidePanelLayout>
  hunkReviewWidthByWorkspace?: Record<string, number>
  fileTreeExpandedPathsByWorkspace?: Record<string, string[]>
  reviewPanelStateByWorkspace?: Record<string, ReviewPanelPersistedState>
  stagedSelectionByWorkspace?: Record<string, string[]>
  workspaceTodos?: Record<string, TodoItem[]>
  sidebarActionOrder?: SidebarActionId[]
  collapsedSidebarSections?: Record<string, boolean>
  composioWebhook?: ComposioWebhookSettings
  spotlightWorkspaceIdByProject?: Record<string, string | null>
  /**
   * Last-known working-tree status per worktree path (lightweight subset of the
   * in-memory `workingTreeDiffSnapshots`). Persisted so the Changes panel can
   * render its file list synchronously on cold app boot — the fetched truth
   * reconciles in place. Diff bodies are NOT persisted (they belong to the
   * diff viewer and are regenerated on demand).
   */
  workingTreeStatusByPath?: Record<string, GitStatusSnapshot>
  sideTerminalsByWorkspace?: Record<string, SideTerminalSession[]>
}
