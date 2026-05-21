import { create } from 'zustand'
import type {
  AgentType,
  AppState,
  Automation,
  ChatSnippet,
  Folder,
  LinearIssuesPriorityPreset,
  PersistedState,
  Project,
  SkillEntry,
  SidebarActionId,
  PanelDockDrag,
  StartupCommand,
  SubagentEntry,
  Tab,
  SplitNode,
  Workspace,
} from './types'
import {
  DEFAULT_SETTINGS,
  DEFAULT_SIDEBAR_ACTION_ORDER,
  DEFAULT_SIDE_PANEL_LAYOUT,
  normalizeLinearIssueCodingAgent,
  normalizeLinearIssueCodingModel,
  normalizeConflictResolverAgent,
  normalizeConflictResolverModel,
  normalizePiCommitMessageModel,
  normalizeLinearIssueDensity,
  normalizeLinearIssueFilters,
  normalizeLinearIssueScope,
  normalizeLinearIssueStateGroupsCollapsed,
  normalizeLinearIssuesPriorityPreset,
  normalizeLinearWorkspaceTabOrder,
  normalizeLinearWorkspaceView,
} from './types'
import {
  formatLinearIssueAgentPrompt,
  linearIssueAgentBranchName,
  linearIssueMoveToInProgress,
  type LinearIssueNode,
} from '../linear/linear-api'
import { buildAdHocAgentCommand, planAgentToPtyAgentType } from '../../shared/plan-build-command'
import { AGENT_PLAN_DIRS_LABEL } from '../utils/agent-plan-dirs'
import { GEMINI_TAB_LABEL, isGeminiIdleOscTitle } from '../../shared/gemini-tab-title'
import { syncConductorAuthKeys } from '../lib/conductor-sign-in'
import {
  getAllPtyIds,
  splitLeaf,
  removeLeaf,
  findLeaf,
  findLeafByPtyId,
  firstLeaf,
  firstTerminalLeaf,
  collectLeaves,
  normalizeSplitTree,
  getFocusedPtyId,
  resolvePtyForPlanSourceFilePath,
  retargetFilePathInSplitRoot,
  graftTree,
  tabToSplitTree,
  resolveAgentPtyForContextInjection,
} from './split-helpers'
import { formatChatContext } from '../utils/chat-context-formatter'
import { wrapBracketedPaste } from '../utils/bracketed-paste'

/** Dedupe concurrent “open Linear issue in agent” runs per issue id. */
const linearIssueAgentLaunchInFlight = new Set<string>()

function normalizeRepoPathCompareKey(path: string): string {
  return path.trim().replace(/\/+$/, '')
}

function resolveProjectForAutomationRun(
  projects: Project[],
  projectId: string,
  repoPathHint?: string,
): Project | null {
  if (projectId) {
    const byId = projects.find((p) => p.id === projectId)
    if (byId) return byId
  }
  const hint = repoPathHint?.trim()
  if (!hint) return null
  const key = normalizeRepoPathCompareKey(hint)
  return projects.find((p) => normalizeRepoPathCompareKey(p.repoPath) === key) ?? null
}

function linearIssueWorktreeDirectoryName(issue: LinearIssueNode): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  const idSlug =
    issue.identifier
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'issue'
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `linear-${idSlug}-${ts}`
}
import {
  getRenderableProjectWorkspaces,
  getSwitchableVisibleProjects,
  getVisibleProjects,
  getVisibleWorkspaces,
  resolveProjectTargetWorkspace as resolveSidebarProjectTargetWorkspace,
} from './sidebar-navigation'
import {
  isDetachedHeadBranchLabel,
  preserveWorkspaceBranch,
} from './workspace-branch'
import { formatReviewForAgent } from '../utils/review-formatter'
import { maybeShowStaleMainToast } from '../utils/ipc-stale-main'
import {
  activatePanel as activateSidePanelLayout,
  movePanelToSide as movePanelToSideLayout,
  normalizePersistedSidePanelLayout,
  normalizeSidePanelLayout,
  setNavigationPanelSide as setNavigationPanelSideLayout,
  setProjectPanelSide as setProjectPanelSideLayout,
  setSidePanelActive as setSidePanelActiveLayout,
  setSidePanelOpen as setSidePanelOpenLayout,
  swapSidebarRoles as swapSidebarRolesLayout,
  toggleSidePanel as toggleSidePanelLayout,
} from './side-panels'
import { pathsEqualOrAlias } from '../../shared/agent-plan-path'
import { normalizeEditorLanguageOverrideMap } from '../utils/language-map'
import type { DesktopAppState } from '../../shared/pi/pi-desktop-state'
import {
  DEFAULT_AUTOMATION_COOLDOWN_MS,
  type AutomationAction,
  type AutomationConfigLike,
  type AutomationTrigger,
} from '../../shared/automation-types'
import {
  DEFAULT_COMPOSIO_WEBHOOK_SETTINGS,
  type ComposioWebhookSettings,
} from '../../shared/composio-types'
import { normalizeWorktreeCredentialRules } from '../../shared/worktree-credentials'

const DEFAULT_PR_LINK_PROVIDER = 'github' as const

/** Removed settings — strip from persisted JSON so old installs do not re-save them. */
const LEGACY_REMOVED_SETTING_KEYS = [
  'phoneControlEnabled',
  'phoneControlContactId',
  'phoneControlNotifyOnStart',
  'phoneControlNotifyOnFinish',
  'phoneControlStreamOutput',
  'phoneControlStreamIntervalSec',
  'linearResolverDefaultSource',
] as const

/** Strip unknown persisted fields (e.g. legacy waitFor / waitCondition). */
function normalizeHydratedStartupCommands(raw: Project['startupCommands']): StartupCommand[] | undefined {
  if (!raw?.length) return undefined
  const out: StartupCommand[] = []
  for (const c of raw) {
    const command = typeof c.command === 'string' ? c.command : ''
    if (!command.trim()) continue
    out.push({ name: typeof c.name === 'string' ? c.name : '', command })
  }
  return out.length > 0 ? out : undefined
}

function normalizeSkillEntries(raw: unknown): SkillEntry[] {
  if (!Array.isArray(raw)) return []
  const out: SkillEntry[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.name !== 'string' || typeof record.sourcePath !== 'string') continue
    out.push({
      id: record.id,
      name: record.name,
      description: typeof record.description === 'string' ? record.description : '',
      sourcePath: record.sourcePath,
      enabled: Boolean(record.enabled),
    })
  }
  return out
}

function normalizeSubagentEntries(raw: unknown): SubagentEntry[] {
  if (!Array.isArray(raw)) return []
  const out: SubagentEntry[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.name !== 'string' || typeof record.sourcePath !== 'string') continue
    out.push({
      id: record.id,
      name: record.name,
      description: typeof record.description === 'string' ? record.description : '',
      sourcePath: record.sourcePath,
      tools: typeof record.tools === 'string' ? record.tools : undefined,
      enabled: Boolean(record.enabled),
    })
  }
  return out
}

function normalizeProject(project: Project): Project {
  const preferredTrunk = typeof project.graphitePreferredTrunk === 'string'
    ? project.graphitePreferredTrunk.trim() || null
    : null
  const normalized: Project = {
    ...project,
    prLinkProvider: project.prLinkProvider ?? DEFAULT_PR_LINK_PROVIDER,
    startupCommands: normalizeHydratedStartupCommands(project.startupCommands),
  }
  if (project.graphiteNewBranchSource !== 'trunk' && project.graphiteNewBranchSource !== 'branch') {
    delete normalized.graphiteNewBranchSource
  }
  if (preferredTrunk) {
    normalized.graphitePreferredTrunk = preferredTrunk
  } else {
    delete normalized.graphitePreferredTrunk
  }
  return normalized
}

function startupCommandsEqual(a: StartupCommand[] | undefined, b: StartupCommand[] | undefined): boolean {
  const left = normalizeHydratedStartupCommands(a) ?? []
  const right = normalizeHydratedStartupCommands(b) ?? []
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i]?.name !== right[i]?.name) return false
    if (left[i]?.command !== right[i]?.command) return false
  }
  return true
}

function setProjectStartupCommandsInStore(projectId: string, startupCommands: StartupCommand[] | undefined): void {
  useAppStore.setState((state) => ({
    projects: state.projects.map((project) => {
      if (project.id !== projectId) return project
      if (startupCommandsEqual(project.startupCommands, startupCommands)) return project
      return { ...project, startupCommands }
    }),
  }))
}

async function syncExternalProjectStartupCommandsForProject(
  projectId: string,
  repoPath: string,
  legacyStartupCommands?: StartupCommand[],
): Promise<void> {
  try {
    const externalRaw = await window.api.projectStartupSettings.get(repoPath)
    const external = externalRaw ? normalizeHydratedStartupCommands(externalRaw) : undefined
    if (external) {
      setProjectStartupCommandsInStore(projectId, external)
      return
    }

    const legacy = normalizeHydratedStartupCommands(legacyStartupCommands)
    if (legacy) {
      const saved = normalizeHydratedStartupCommands(await window.api.projectStartupSettings.set(repoPath, legacy))
      setProjectStartupCommandsInStore(projectId, saved ?? legacy)
      return
    }

    setProjectStartupCommandsInStore(projectId, undefined)
  } catch (err) {
    maybeShowStaleMainToast(err, useAppStore.getState().addToast)
    console.error('Failed to sync project startup settings:', err)
  }
}

async function syncExternalProjectStartupSettingsForProjects(projects: Project[]): Promise<void> {
  await Promise.all(
    projects.map((project) =>
      syncExternalProjectStartupCommandsForProject(project.id, project.repoPath, project.startupCommands),
    ),
  )
}

async function normalizeProjectRepoAnchorsInStore(): Promise<void> {
  const projects = useAppStore.getState().projects
  let repairedCount = 0

  for (const project of projects) {
    try {
      const anchored = await window.api.git.getProjectRepoAnchor(project.repoPath)
      if (!anchored || pathsEqualOrAlias(project.repoPath, anchored)) continue
      useAppStore.getState().updateProject(project.id, { repoPath: anchored })
      repairedCount += 1
    } catch {
      /* best-effort */
    }
  }

  if (repairedCount > 0) {
    console.info(`[constellagent] normalized ${repairedCount} persisted project repo path(s)`)
  }
}
const TAB_TITLE_LOG = '[constellagent:tab-title]'

const AGENT_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  cursor: 'Cursor Agent',
  opencode: 'OpenCode',
  'pi-constell': 'PI Constell',
}

const GENERIC_AGENT_TITLES = new Set(Object.values(AGENT_NAMES))

function terminalTabHasPtyId(tab: Tab, ptyId: string): tab is Extract<Tab, { type: 'terminal' }> {
  if (tab.type !== 'terminal') return false
  if (tab.ptyId === ptyId) return true
  return tab.splitRoot ? findLeafByPtyId(tab.splitRoot, ptyId) != null : false
}

function isGenericTerminalTitle(title: string): boolean {
  if (!title.trim()) return true
  if (GENERIC_AGENT_TITLES.has(title)) return true
  return /^Terminal \d+$/.test(title)
}

function activeAgentSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

function legacyPromptForAction(action: AutomationAction | undefined): string {
  return action?.type === 'run-prompt' ? action.prompt : ''
}

function legacyCronForTrigger(trigger: AutomationTrigger | undefined): string {
  return trigger?.type === 'cron' ? trigger.cronExpression : ''
}

function isUnknownRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function normalizeComposioWebhook(raw: unknown): ComposioWebhookSettings {
  const d = DEFAULT_COMPOSIO_WEBHOOK_SETTINGS
  if (!isUnknownRecord(raw)) return { ...d }
  return {
    enabled: Boolean(raw.enabled),
    port:
      typeof raw.port === 'number' && Number.isFinite(raw.port) && raw.port > 0 && raw.port < 65536
        ? Math.floor(raw.port)
        : d.port,
    path: typeof raw.path === 'string' && raw.path.startsWith('/') ? raw.path : d.path,
    sharedSecret: typeof raw.sharedSecret === 'string' ? raw.sharedSecret : '',
    bindAllInterfaces: Boolean(raw.bindAllInterfaces),
    publicBaseUrl:
      typeof raw.publicBaseUrl === 'string' ? raw.publicBaseUrl.trim().replace(/\/+$/, '') : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
  }
}

function normalizeRendererAutomation(raw: Partial<Automation> & { id: string; name: string; projectId: string }): Automation {
  const trigger: AutomationTrigger = raw.trigger ?? {
    type: 'cron',
    cronExpression: raw.cronExpression ?? '',
  }
  const action: AutomationAction = raw.action ?? {
    type: 'run-prompt',
    prompt: raw.prompt ?? '',
  }

  return {
    id: raw.id,
    name: raw.name,
    projectId: raw.projectId,
    prompt: raw.prompt ?? legacyPromptForAction(action),
    cronExpression: raw.cronExpression ?? legacyCronForTrigger(trigger),
    enabled: raw.enabled ?? true,
    createdAt: raw.createdAt ?? Date.now(),
    trigger,
    action,
    cooldownMs: raw.cooldownMs ?? DEFAULT_AUTOMATION_COOLDOWN_MS,
    lastRunAt: raw.lastRunAt,
    lastRunStatus: raw.lastRunStatus,
    composio: raw.composio,
  }
}

function toAutomationIpcConfig(automation: Automation, repoPath: string): AutomationConfigLike {
  return {
    id: automation.id,
    name: automation.name,
    projectId: automation.projectId,
    trigger: automation.trigger ?? { type: 'cron', cronExpression: automation.cronExpression },
    action: automation.action ?? { type: 'run-prompt', prompt: automation.prompt },
    enabled: automation.enabled,
    repoPath,
    cooldownMs: automation.cooldownMs ?? DEFAULT_AUTOMATION_COOLDOWN_MS,
    ...(automation.composio ? { composio: automation.composio } : {}),
  }
}

/** Drop plan→terminal entries when the terminal tab no longer exists (e.g. bulk tab removal). */
function planBuildMapForTabs(map: Record<string, string>, tabs: Tab[]): Record<string, string> {
  const terminalIds = new Set(
    tabs.filter((t): t is Extract<Tab, { type: 'terminal' }> => t.type === 'terminal').map((t) => t.id),
  )
  const next: Record<string, string> = {}
  for (const [path, tabId] of Object.entries(map)) {
    if (terminalIds.has(tabId)) next[path] = tabId
  }
  return next
}

/** Filter invalid IDs and append any missing ones (forward-compat when new actions are added). */
function normalizeSpotlightWorkspaceMap(raw: unknown): Record<string, string | null> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
    else if (v === null) out[k] = null
  }
  return out
}

function normalizeSidebarActionOrder(raw: SidebarActionId[] | undefined): SidebarActionId[] {
  const valid = new Set<SidebarActionId>(DEFAULT_SIDEBAR_ACTION_ORDER)
  const seen = new Set<SidebarActionId>()
  const result: SidebarActionId[] = []
  if (raw) {
    for (const id of raw) {
      if (valid.has(id) && !seen.has(id)) {
        result.push(id)
        seen.add(id)
      }
    }
  }
  for (const id of DEFAULT_SIDEBAR_ACTION_ORDER) {
    if (!seen.has(id)) result.push(id)
  }
  return result
}

/** Track 4/3/7: deserialize string-array-by-workspace maps with light validation. */
function normalizeStringArrayByWorkspace(
  raw: Record<string, string[]> | undefined,
): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || !Array.isArray(v)) continue
    out[k] = v.filter((p): p is string => typeof p === 'string')
  }
  return out
}

/** Track 3: deserialize the per-workspace HunkReview UI state. */
function normalizeReviewPanelStateByWorkspace(
  raw: Record<string, Partial<import('./types').ReviewPanelPersistedState>> | undefined,
): Record<string, import('./types').ReviewPanelPersistedState> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, import('./types').ReviewPanelPersistedState> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || !v || typeof v !== 'object') continue
    const reviewMode = v.reviewMode === 'tour' ? 'tour' : 'annotations'
    const activeTourStepId = typeof v.activeTourStepId === 'string' ? v.activeTourStepId : null
    const activeFile = typeof v.activeFile === 'string' ? v.activeFile : null
    const visibleCount = typeof v.visibleCount === 'number' && Number.isFinite(v.visibleCount)
      ? Math.max(1, Math.floor(v.visibleCount))
      : 50
    const viewedFilePaths = Array.isArray(v.viewedFilePaths)
      ? v.viewedFilePaths.filter((p): p is string => typeof p === 'string')
      : []
    const selectedIds = Array.isArray(v.selectedIds)
      ? v.selectedIds.filter((p): p is string => typeof p === 'string')
      : []
    out[k] = { reviewMode, activeTourStepId, activeFile, visibleCount, viewedFilePaths, selectedIds }
  }
  return out
}

/** Track 8: per-workspace panel layout migration. On first load after upgrade,
 *  seed every existing workspace with the previous global layout so the UI
 *  doesn't snap back to defaults. */
function normalizeSidePanelsByWorkspace(
  raw: Record<string, import('./types').SidePanelLayout> | undefined,
  fallback: import('./types').SidePanelLayout,
  workspaces: Workspace[],
): Record<string, import('./types').SidePanelLayout> {
  const out: Record<string, import('./types').SidePanelLayout> = {}
  const wsIds = new Set(workspaces.map((w) => w.id))
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (!wsIds.has(k) || !v || typeof v !== 'object') continue
      out[k] = normalizeSidePanelLayout(v)
    }
  }
  // Seed any missing workspaces with the previous global layout (acts as
  // forward-migration: existing users keep their layout per workspace).
  for (const ws of workspaces) {
    if (!out[ws.id]) out[ws.id] = normalizeSidePanelLayout(fallback)
  }
  return out
}

/** Track 8: per-workspace HunkReview width override. Seed missing entries from
 *  the legacy global setting so existing widths stay intact. */
function normalizeHunkReviewWidthByWorkspace(
  raw: Record<string, number> | undefined,
  fallback: number | undefined,
): Record<string, number> {
  const out: Record<string, number> = {}
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof k === 'string' && typeof v === 'number' && Number.isFinite(v)) out[k] = v
    }
  }
  // If a legacy global value exists and the map is empty, leave map empty —
  // entries will be seeded lazily as the user resizes per-workspace.
  void fallback
  return out
}

/**
 * Sidebar folders: every project keeps a "Priority" + "Non-Priority" pair.
 * `seedFoldersForProjects` builds folders for any project missing pointers
 * (legacy state). Reassigns dangling workspaces to the default folder.
 */
function seedFoldersForProjects(
  projects: Project[],
  workspaces: Workspace[],
  folders: Folder[],
): { projects: Project[]; workspaces: Workspace[]; folders: Folder[] } {
  const nextFolders = [...folders]
  const folderIds = new Set(nextFolders.map((f) => f.id))
  const foldersByProject = new Map<string, Folder[]>()
  for (const f of nextFolders) {
    const list = foldersByProject.get(f.projectId) ?? []
    list.push(f)
    foldersByProject.set(f.projectId, list)
  }

  const nextProjects = projects.map((project) => {
    let projectFolders = foldersByProject.get(project.id) ?? []
    let priorityId = project.priorityFolderId && folderIds.has(project.priorityFolderId) ? project.priorityFolderId : null
    let defaultId = project.defaultFolderId && folderIds.has(project.defaultFolderId) ? project.defaultFolderId : null

    if (!priorityId || !defaultId || projectFolders.length === 0) {
      // Reuse existing folders that match canonical names if present; otherwise create.
      let priority = projectFolders.find((f) => f.id === priorityId)
        ?? projectFolders.find((f) => f.name.toLowerCase() === 'priority')
      let nonPriority = projectFolders.find((f) => f.id === defaultId && f.id !== priority?.id)
        ?? projectFolders.find((f) => f !== priority && f.name.toLowerCase() === 'non-priority')

      if (!priority) {
        priority = { id: crypto.randomUUID(), projectId: project.id, name: 'Priority', order: 0 }
        nextFolders.push(priority)
        folderIds.add(priority.id)
        projectFolders = [...projectFolders, priority]
      }
      if (!nonPriority) {
        nonPriority = { id: crypto.randomUUID(), projectId: project.id, name: 'Non-Priority', order: 1 }
        nextFolders.push(nonPriority)
        folderIds.add(nonPriority.id)
        projectFolders = [...projectFolders, nonPriority]
      }
      priorityId = priority.id
      defaultId = nonPriority.id
      foldersByProject.set(project.id, projectFolders)
    }

    if (project.priorityFolderId === priorityId && project.defaultFolderId === defaultId) return project
    return { ...project, priorityFolderId: priorityId, defaultFolderId: defaultId }
  })

  const projectDefaults = new Map<string, string>()
  for (const project of nextProjects) {
    if (project.defaultFolderId) projectDefaults.set(project.id, project.defaultFolderId)
  }

  const nextWorkspaces = workspaces.map((ws) => {
    if (ws.folderId && folderIds.has(ws.folderId)) {
      const folder = nextFolders.find((f) => f.id === ws.folderId)
      if (folder && folder.projectId === ws.projectId) return ws
    }
    const fallback = projectDefaults.get(ws.projectId)
    if (!fallback) return ws
    if (ws.folderId === fallback) return ws
    return { ...ws, folderId: fallback }
  })

  return { projects: nextProjects, workspaces: nextWorkspaces, folders: nextFolders }
}

function normalizeFolders(raw: unknown): Folder[] {
  if (!Array.isArray(raw)) return []
  const out: Folder[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const r = entry as Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.projectId !== 'string' || typeof r.name !== 'string') continue
    const order = typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : out.length
    out.push({
      id: r.id,
      projectId: r.projectId,
      name: r.name,
      order,
      collapsed: r.collapsed === true ? true : undefined,
    })
  }
  return out
}

function pruneLastActiveWorkspaceByProjectId(
  lastActiveWorkspaceByProjectId: Record<string, string>,
  projects: Project[],
  workspaces: Workspace[],
): Record<string, string> {
  const validProjectIds = new Set(projects.map((project) => project.id))
  const validWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id))
  const next: Record<string, string> = {}
  for (const [projectId, workspaceId] of Object.entries(lastActiveWorkspaceByProjectId)) {
    if (validProjectIds.has(projectId) && validWorkspaceIds.has(workspaceId)) {
      next[projectId] = workspaceId
    }
  }
  return next
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  workspaces: [],
  folders: [],
  tabs: [],
  automations: [],
  activeWorkspaceId: null,
  activeTabId: null,
  lastActiveTabByWorkspace: {},
  sidePanels: DEFAULT_SIDE_PANEL_LAYOUT,
  sidePanelsByWorkspace: {},
  hunkReviewWidthByWorkspace: {},
  fileTreeExpandedPathsByWorkspace: {},
  reviewPanelStateByWorkspace: {},
  stagedSelectionByWorkspace: {},
  panelDockDrag: null,
  collapsedProjectIds: new Set<string>(),
  lastActiveWorkspaceByProjectId: {},
  lastSavedTabId: null,
  workspaceDialogProjectId: null,
  settings: { ...DEFAULT_SETTINGS },
  composioWebhook: { ...DEFAULT_COMPOSIO_WEBHOOK_SETTINGS },
  settingsOpen: false,
  settingsSection: 'appearance',
  automationsOpen: false,
  linearPanelOpen: false,
  confirmDialog: null,
  toasts: [],
  quickOpenVisible: false,
  editorFindContext: null,
  quickOpenInitialQuery: null,
  linearQuickOpenVisible: false,
  changesFileFind: null,
  planPaletteVisible: false,
  hunkReviewOpen: false,
  hunkReviewWorkspaceId: null,
  unreadWorkspaceIds: new Set<string>(),
  activeClaudeWorkspaceIds: new Set<string>(),
  prStatusMap: new Map(),
  ghAvailability: new Map(),
  defaultBranchByProjectId: new Map(),
  gitFileStatuses: new Map(),
  workingTreeDiffSnapshots: new Map(),
  worktreeSyncStatus: new Map(),
  graphiteStacks: new Map(),
  graphiteStackExpanded: false,
  spotlightWorkspaceIdByProject: {},
  spotlightStatusByProject: new Map(),
  lastKnownRemoteHead: {},
  activeMonacoEditor: null,
  planBuildTerminalByPlanPath: {},
  contextWindowData: null,
  sidebarActionOrder: [...DEFAULT_SIDEBAR_ACTION_ORDER],

  addProject: (project) => {
    const normalizedProject = normalizeProject(project)
    set((s) => {
      const projects = [...s.projects, normalizedProject]
      const seeded = seedFoldersForProjects(projects, s.workspaces, s.folders)
      return { projects: seeded.projects, workspaces: seeded.workspaces, folders: seeded.folders }
    })
    void syncExternalProjectStartupCommandsForProject(
      normalizedProject.id,
      normalizedProject.repoPath,
      normalizedProject.startupCommands,
    )
    void window.api.git.startSyncPolling(project.id, project.repoPath)
    void reconcileGitWorktreesForStore(project.id)
  },

  removeProject: (id) => {
    void window.api.git.stopSyncPolling(id)
    set((s) => {
      // Clean up automations for this project in main process
      const projectAutomations = s.automations.filter((a) => a.projectId === id)
      for (const a of projectAutomations) {
        window.api.automations.delete(a.id)
      }
      const removedWsIds = new Set(s.workspaces.filter((w) => w.projectId === id).map((w) => w.id))
      const newProjects = s.projects.filter((p) => p.id !== id)
      const newWorkspaces = s.workspaces.filter((w) => w.projectId !== id)
      const newTabs = s.tabs.filter((t) => !removedWsIds.has(t.workspaceId))
      const planBuildTerminalByPlanPath = planBuildMapForTabs(s.planBuildTerminalByPlanPath, newTabs)
      const newAutomations = s.automations.filter((a) => a.projectId !== id)
      const newUnread = new Set(Array.from(s.unreadWorkspaceIds).filter((wsId) => !removedWsIds.has(wsId)))
      const newActiveClaude = new Set(Array.from(s.activeClaudeWorkspaceIds).filter((wsId) => !removedWsIds.has(wsId)))
      const newPrStatusMap = new Map(
        Array.from(s.prStatusMap.entries()).filter(([key]) => !key.startsWith(`${id}:`))
      )
      const newGhAvailability = new Map(s.ghAvailability)
      newGhAvailability.delete(id)
      const newDefaultBranchByProjectId = new Map(s.defaultBranchByProjectId)
      newDefaultBranchByProjectId.delete(id)

      const newWorktreeSyncStatus = new Map(s.worktreeSyncStatus)
      const newGraphiteStacks = new Map(s.graphiteStacks)
      for (const ws of s.workspaces.filter((w) => w.projectId === id)) {
        newWorktreeSyncStatus.delete(ws.id)
        newGraphiteStacks.delete(ws.id)
      }
      const newSpotlightStatusByProject = new Map(s.spotlightStatusByProject)
      newSpotlightStatusByProject.delete(id)
      const newSpotlightWorkspaceIdByProject = { ...s.spotlightWorkspaceIdByProject }
      delete newSpotlightWorkspaceIdByProject[id]

      const tabMap = { ...s.lastActiveTabByWorkspace }
      for (const wsId of removedWsIds) delete tabMap[wsId]
      const collapsedProjectIds = new Set(s.collapsedProjectIds)
      collapsedProjectIds.delete(id)
      const lastActiveWorkspaceByProjectId = pruneLastActiveWorkspaceByProjectId(
        s.lastActiveWorkspaceByProjectId,
        newProjects,
        newWorkspaces,
      )

      const activeWorkspaceId =
        s.activeWorkspaceId && removedWsIds.has(s.activeWorkspaceId)
          ? (newWorkspaces[0]?.id ?? null)
          : s.activeWorkspaceId
      const activeTabId = newTabs.some((t) => t.id === s.activeTabId)
        ? s.activeTabId
        : (newTabs.find((t) => t.workspaceId === activeWorkspaceId)?.id ?? newTabs[0]?.id ?? null)

      const newFolders = s.folders.filter((f) => f.projectId !== id)

      return {
        projects: newProjects,
        workspaces: newWorkspaces,
        folders: newFolders,
        tabs: newTabs,
        automations: newAutomations,
        unreadWorkspaceIds: newUnread,
        activeClaudeWorkspaceIds: newActiveClaude,
        prStatusMap: newPrStatusMap,
        ghAvailability: newGhAvailability,
        defaultBranchByProjectId: newDefaultBranchByProjectId,
        worktreeSyncStatus: newWorktreeSyncStatus,
        graphiteStacks: newGraphiteStacks,
        spotlightStatusByProject: newSpotlightStatusByProject,
        spotlightWorkspaceIdByProject: newSpotlightWorkspaceIdByProject,
        collapsedProjectIds,
        lastActiveWorkspaceByProjectId,
        activeWorkspaceId,
        activeTabId,
        lastActiveTabByWorkspace: tabMap,
        planBuildTerminalByPlanPath,
      }
    })
  },

  addWorkspace: (workspace) => {
    window.api.automations.emitWorkspaceEvent({
      type: 'workspace:created',
      workspaceId: workspace.id,
      projectId: workspace.projectId,
      branch: workspace.branch,
      meta: workspace.automationId ? { automationOrigin: workspace.automationId } : undefined,
    })
    set((s) => {
      const project = s.projects.find((p) => p.id === workspace.projectId)
      const folderId = workspace.folderId ?? project?.defaultFolderId ?? undefined
      const ws = folderId ? { ...workspace, folderId } : workspace
      return {
        workspaces: [...s.workspaces, ws],
        activeWorkspaceId: ws.id,
        lastActiveWorkspaceByProjectId: {
          ...s.lastActiveWorkspaceByProjectId,
          [ws.projectId]: ws.id,
        },
      }
    })
  },

  removeWorkspace: (id) => {
    const workspace = get().workspaces.find((entry) => entry.id === id)
    if (workspace) {
      window.api.automations.emitWorkspaceEvent({
        type: 'workspace:deleted',
        workspaceId: workspace.id,
        projectId: workspace.projectId,
        branch: workspace.branch,
        meta: workspace.automationId ? { automationOrigin: workspace.automationId } : undefined,
      })
    }
    set((s) => {
      const newWorkspaces = s.workspaces.filter((w) => w.id !== id)
      const newTabs = s.tabs.filter((t) => t.workspaceId !== id)
      const planBuildTerminalByPlanPath = planBuildMapForTabs(s.planBuildTerminalByPlanPath, newTabs)
      const newUnread = new Set(s.unreadWorkspaceIds)
      newUnread.delete(id)
      const newActiveClaude = new Set(s.activeClaudeWorkspaceIds)
      newActiveClaude.delete(id)
      const tabMap = { ...s.lastActiveTabByWorkspace }
      delete tabMap[id]
      const newWorktreeSyncStatus = new Map(s.worktreeSyncStatus)
      newWorktreeSyncStatus.delete(id)
      const newGraphiteStacks = new Map(s.graphiteStacks)
      newGraphiteStacks.delete(id)
      const lastActiveWorkspaceByProjectId = pruneLastActiveWorkspaceByProjectId(
        s.lastActiveWorkspaceByProjectId,
        s.projects,
        newWorkspaces,
      )
      const replacementWorkspaceId = newWorkspaces.find((workspace) => (
        newTabs.some((tab) => tab.workspaceId === workspace.id)
      ))?.id ?? newWorkspaces[0]?.id ?? null
      const nextActiveWorkspaceId =
        s.activeWorkspaceId === id
          ? replacementWorkspaceId
          : s.activeWorkspaceId
      const nextWorkspaceTabs = nextActiveWorkspaceId
        ? newTabs.filter((tab) => tab.workspaceId === nextActiveWorkspaceId)
        : []
      const rememberedActiveTabId = nextActiveWorkspaceId
        ? tabMap[nextActiveWorkspaceId] ?? null
        : null
      const nextActiveTabId = nextActiveWorkspaceId
        ? (
          s.activeWorkspaceId !== id && s.activeTabId && nextWorkspaceTabs.some((tab) => tab.id === s.activeTabId)
            ? s.activeTabId
            : rememberedActiveTabId && nextWorkspaceTabs.some((tab) => tab.id === rememberedActiveTabId)
              ? rememberedActiveTabId
              : nextWorkspaceTabs[0]?.id ?? null
        )
        : null
      return {
        workspaces: newWorkspaces,
        tabs: newTabs,
        unreadWorkspaceIds: newUnread,
        activeClaudeWorkspaceIds: newActiveClaude,
        worktreeSyncStatus: newWorktreeSyncStatus,
        graphiteStacks: newGraphiteStacks,
        lastActiveWorkspaceByProjectId,
        lastActiveTabByWorkspace: tabMap,
        planBuildTerminalByPlanPath,
        activeWorkspaceId: nextActiveWorkspaceId,
        activeTabId: nextActiveTabId,
      }
    })
  },

  renameWorkspace: (id, name) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => w.id === id ? { ...w, name } : w),
    })),

  reorderWorkspace: (fromId, toId) => {
    if (fromId === toId) return
    set((s) => {
      const fromIdx = s.workspaces.findIndex((w) => w.id === fromId)
      const toIdx = s.workspaces.findIndex((w) => w.id === toId)
      if (fromIdx === -1 || toIdx === -1) return s
      if (s.workspaces[fromIdx].projectId !== s.workspaces[toIdx].projectId) return s
      const next = [...s.workspaces]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return { workspaces: next }
    })
  },

  reorderProject: (fromId, toId) => {
    if (fromId === toId) return
    set((s) => {
      const fromIdx = s.projects.findIndex((p) => p.id === fromId)
      const toIdx = s.projects.findIndex((p) => p.id === toId)
      if (fromIdx === -1 || toIdx === -1) return s
      const next = [...s.projects]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return { projects: next }
    })
  },

  reorderSidebarAction: (fromId, toId) => {
    if (fromId === toId) return
    set((s) => {
      const fromIdx = s.sidebarActionOrder.indexOf(fromId)
      const toIdx = s.sidebarActionOrder.indexOf(toId)
      if (fromIdx === -1 || toIdx === -1) return s
      const next = [...s.sidebarActionOrder]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return { sidebarActionOrder: next }
    })
  },

  addFolder: (projectId, name) => {
    const id = crypto.randomUUID()
    set((s) => {
      const siblingMax = s.folders
        .filter((f) => f.projectId === projectId)
        .reduce((max, f) => Math.max(max, f.order), -1)
      const folder: Folder = {
        id,
        projectId,
        name: name.trim() || 'Folder',
        order: siblingMax + 1,
      }
      return { folders: [...s.folders, folder] }
    })
    return id
  },

  renameFolder: (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set((s) => ({
      folders: s.folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f)),
    }))
  },

  removeFolder: (id, reassignTo) => {
    set((s) => {
      const folder = s.folders.find((f) => f.id === id)
      if (!folder) return s
      const siblings = s.folders.filter((f) => f.projectId === folder.projectId && f.id !== id)
      if (siblings.length === 0) return s
      const project = s.projects.find((p) => p.id === folder.projectId)

      const firstSiblingByOrder = siblings.slice().sort((a, b) => a.order - b.order)[0]!.id
      const explicit = reassignTo && siblings.some((f) => f.id === reassignTo) ? reassignTo : null
      // Pointer migration: if the deleted folder is the default/priority pointer,
      // move it to the explicit target or the first remaining folder.
      const newDefaultId =
        project?.defaultFolderId === id
          ? explicit ?? firstSiblingByOrder
          : project?.defaultFolderId ?? firstSiblingByOrder
      const newPriorityId =
        project?.priorityFolderId === id
          ? explicit ?? firstSiblingByOrder
          : project?.priorityFolderId ?? firstSiblingByOrder
      // Workspaces in the deleted folder land in the (post-update) defaultFolderId.
      const workspaceTargetId = explicit ?? newDefaultId

      const projects = s.projects.map((p) => {
        if (p.id !== folder.projectId) return p
        return { ...p, defaultFolderId: newDefaultId, priorityFolderId: newPriorityId }
      })
      const workspaces = s.workspaces.map((w) => (w.folderId === id ? { ...w, folderId: workspaceTargetId } : w))
      const folders = s.folders.filter((f) => f.id !== id)
      return { projects, workspaces, folders }
    })
  },

  reorderFolder: (fromId, toId) => {
    if (fromId === toId) return
    set((s) => {
      const from = s.folders.find((f) => f.id === fromId)
      const to = s.folders.find((f) => f.id === toId)
      if (!from || !to || from.projectId !== to.projectId) return s
      const list = s.folders
        .filter((f) => f.projectId === from.projectId)
        .slice()
        .sort((a, b) => a.order - b.order)
      const fromIdx = list.findIndex((f) => f.id === fromId)
      const toIdx = list.findIndex((f) => f.id === toId)
      if (fromIdx === -1 || toIdx === -1) return s
      const [moved] = list.splice(fromIdx, 1)
      list.splice(toIdx, 0, moved)
      const orderMap = new Map(list.map((f, idx) => [f.id, idx]))
      const folders = s.folders.map((f) =>
        f.projectId === from.projectId ? { ...f, order: orderMap.get(f.id) ?? f.order } : f,
      )
      return { folders }
    })
  },

  toggleFolderCollapsed: (id) => {
    set((s) => ({
      folders: s.folders.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)),
    }))
  },

  setProjectPriorityFolder: (projectId, folderId) => {
    set((s) => {
      const folder = s.folders.find((f) => f.id === folderId)
      if (!folder || folder.projectId !== projectId) return s
      return {
        projects: s.projects.map((p) => (p.id === projectId ? { ...p, priorityFolderId: folderId } : p)),
      }
    })
  },

  setProjectDefaultFolder: (projectId, folderId) => {
    set((s) => {
      const folder = s.folders.find((f) => f.id === folderId)
      if (!folder || folder.projectId !== projectId) return s
      return {
        projects: s.projects.map((p) => (p.id === projectId ? { ...p, defaultFolderId: folderId } : p)),
      }
    })
  },

  moveWorkspaceToFolder: (workspaceId, folderId) => {
    set((s) => {
      const ws = s.workspaces.find((w) => w.id === workspaceId)
      const folder = s.folders.find((f) => f.id === folderId)
      if (!ws || !folder || folder.projectId !== ws.projectId) return s
      if (ws.folderId === folderId) return s
      return {
        workspaces: s.workspaces.map((w) => (w.id === workspaceId ? { ...w, folderId } : w)),
      }
    })
  },

  togglePriorityForWorkspace: (workspaceId) => {
    set((s) => {
      const ws = s.workspaces.find((w) => w.id === workspaceId)
      if (!ws) return s
      const project = s.projects.find((p) => p.id === ws.projectId)
      if (!project?.priorityFolderId || !project.defaultFolderId) return s
      const targetId = ws.folderId === project.priorityFolderId
        ? project.defaultFolderId
        : project.priorityFolderId
      if (ws.folderId === targetId) return s
      return {
        workspaces: s.workspaces.map((w) => (w.id === workspaceId ? { ...w, folderId: targetId } : w)),
      }
    })
  },

  updateWorkspaceBranch: (id, branch) =>
    set((s) => {
      let changed = false
      const workspaces = s.workspaces.map((w) => {
        if (w.id !== id) return w
        const nextBranch = preserveWorkspaceBranch(w.branch, branch)
        if (nextBranch === w.branch) return w
        changed = true
        return { ...w, branch: nextBranch }
      })
      return changed ? { workspaces } : s
    }),

  refreshGitWorktrees: () => {
    void reconcileGitWorktreesForStore(null)
  },

  setActiveWorkspace: (id) =>
    set((s) => {
      // Remember which tab was active in the workspace we're leaving
      const tabMap = { ...s.lastActiveTabByWorkspace }
      if (s.activeWorkspaceId && s.activeTabId) {
        tabMap[s.activeWorkspaceId] = s.activeTabId
      }

      const lastActiveWorkspaceByProjectId = { ...s.lastActiveWorkspaceByProjectId }
      const currentWorkspace = s.activeWorkspaceId
        ? s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId)
        : undefined
      if (currentWorkspace) {
        lastActiveWorkspaceByProjectId[currentWorkspace.projectId] = currentWorkspace.id
      }

      const nextWorkspace = id
        ? s.workspaces.find((workspace) => workspace.id === id)
        : undefined
      if (nextWorkspace) {
        lastActiveWorkspaceByProjectId[nextWorkspace.projectId] = nextWorkspace.id
      }

      const collapsedProjectIds = new Set(s.collapsedProjectIds)
      if (nextWorkspace) {
        collapsedProjectIds.delete(nextWorkspace.projectId)
      }

      const wsTabs = s.tabs.filter((t) => t.workspaceId === id)
      const newUnread = new Set(s.unreadWorkspaceIds)
      if (id) newUnread.delete(id)

      // Restore remembered tab, falling back to first tab
      const remembered = id ? tabMap[id] : null
      const activeTabId = remembered && wsTabs.some((t) => t.id === remembered)
        ? remembered
        : wsTabs[0]?.id ?? null

      // Track 8: snapshot the leaving workspace's panel layout, then load the
      // entering workspace's layout (or seed it from the current one if none
      // exists yet, so first-time switches don't snap to defaults).
      const sidePanelsByWorkspace = { ...s.sidePanelsByWorkspace }
      if (s.activeWorkspaceId) sidePanelsByWorkspace[s.activeWorkspaceId] = s.sidePanels
      const nextSidePanels = id
        ? sidePanelsByWorkspace[id] ?? s.sidePanels
        : s.sidePanels
      if (id && !sidePanelsByWorkspace[id]) sidePanelsByWorkspace[id] = nextSidePanels

      return {
        activeWorkspaceId: id,
        activeTabId,
        lastActiveTabByWorkspace: tabMap,
        lastActiveWorkspaceByProjectId,
        unreadWorkspaceIds: newUnread,
        collapsedProjectIds,
        sidePanels: nextSidePanels,
        sidePanelsByWorkspace,
      }
    }),

  addTab: (tab) =>
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    })),

  removeTab: (id) =>
    set((s) => {
      const removed = s.tabs.find((t) => t.id === id)
      if (removed?.type === 'service') {
        // Ensure the underlying PTY dies when the user closes the tab.
        try { window.api.pty.destroy(removed.ptyId) } catch {}
      }
      // Track 6: drop the saved scrollback file when its tab closes so the
      // userData/scrollback dir doesn't accrue stale entries.
      if (removed?.type === 'terminal') {
        void window.api.pty.deleteScrollback(removed.id).catch(() => {})
      }
      // Drop conductor-chat.db rows when the last tab for a session closes.
      if (removed?.type === 'conductor' && removed.agentSessionId) {
        const sessionId = removed.agentSessionId
        const stillOpen = s.tabs.some(
          (t) =>
            t.id !== id &&
            t.type === 'conductor' &&
            t.agentSessionId === sessionId,
        )
        if (!stillOpen) {
          void window.api.agentChat.deleteSession(sessionId).catch(() => {})
        }
      }
      let planBuildTerminalByPlanPath = s.planBuildTerminalByPlanPath
      if (removed?.type === 'terminal') {
        const next = { ...planBuildTerminalByPlanPath }
        for (const k of Object.keys(next)) {
          if (next[k] === id) delete next[k]
        }
        planBuildTerminalByPlanPath = next
      }
      const newTabs = s.tabs.filter((t) => t.id !== id)
      const wasActive = s.activeTabId === id
      const wsTabs = newTabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
      return {
        tabs: newTabs,
        activeTabId: wasActive ? (wsTabs[wsTabs.length - 1]?.id ?? null) : s.activeTabId,
        planBuildTerminalByPlanPath,
      }
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  reorderTabsInWorkspace: (workspaceId, orderedIds) => {
    set((s) => {
      const wsTabs = s.tabs.filter((t) => t.workspaceId === workspaceId)
      if (orderedIds.length !== wsTabs.length) return s
      const byId = new Map(wsTabs.map((t) => [t.id, t]))
      if (!orderedIds.every((id) => byId.has(id))) return s
      const ordered = orderedIds.map((id) => byId.get(id)!)
      let oi = 0
      const newTabs = s.tabs.map((t) =>
        t.workspaceId === workspaceId ? ordered[oi++]! : t
      )
      return { tabs: newTabs }
    })
  },

  setSidePanelActive: (side, panel) => set((s) => ({
    sidePanels: setSidePanelActiveLayout(s.sidePanels, side, panel),
  })),

  activatePanel: (panel) => set((s) => ({
    sidePanels: activateSidePanelLayout(s.sidePanels, panel),
  })),

  movePanelToSide: (panel, side) => set((s) => ({
    sidePanels: movePanelToSideLayout(s.sidePanels, panel, side),
  })),

  resetSidePanelLayout: () => set({
    sidePanels: normalizeSidePanelLayout(DEFAULT_SIDE_PANEL_LAYOUT),
  }),

  setProjectPanelSide: (side) => set((s) => ({
    sidePanels: setProjectPanelSideLayout(s.sidePanels, side),
  })),

  setNavigationPanelSide: (side) => set((s) => ({
    sidePanels: setNavigationPanelSideLayout(s.sidePanels, side),
  })),

  swapSidebarRoles: () => set((s) => ({
    sidePanels: swapSidebarRolesLayout(s.sidePanels),
  })),

  setPanelDockDrag: (panelDockDrag: PanelDockDrag | null) => set({ panelDockDrag }),

  toggleSidePanel: (side) => set((s) => ({
    sidePanels: toggleSidePanelLayout(s.sidePanels, side),
  })),

  setSidePanelOpen: (side, open) => set((s) => ({
    sidePanels: setSidePanelOpenLayout(s.sidePanels, side, open),
  })),

  toggleRightPanel: () => set((s) => ({
    sidePanels: toggleSidePanelLayout(s.sidePanels, 'right'),
  })),

  toggleSidebar: () => set((s) => ({
    sidePanels: toggleSidePanelLayout(s.sidePanels, 'left'),
  })),

  toggleProjectCollapsed: (projectId) => set((s) => {
    const collapsedProjectIds = new Set(s.collapsedProjectIds)
    if (collapsedProjectIds.has(projectId)) collapsedProjectIds.delete(projectId)
    else collapsedProjectIds.add(projectId)
    return { collapsedProjectIds }
  }),

  nextTab: () => {
    const s = get()
    const wsTabs = s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
    if (wsTabs.length <= 1) return
    const idx = wsTabs.findIndex((t) => t.id === s.activeTabId)
    const next = wsTabs[(idx + 1) % wsTabs.length]
    set({ activeTabId: next.id })
  },

  prevTab: () => {
    const s = get()
    const wsTabs = s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
    if (wsTabs.length <= 1) return
    const idx = wsTabs.findIndex((t) => t.id === s.activeTabId)
    const prev = wsTabs[(idx - 1 + wsTabs.length) % wsTabs.length]
    set({ activeTabId: prev.id })
  },

  createServiceForActiveWorkspace: async ({ scriptName, command }) => {
    const s = get()
    if (!s.activeWorkspaceId) return
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    if (!ws) return
    // Renderer can't see process.env.SHELL under contextIsolation; main resolves `${shell} -l -c …`,
    // so we just need *some* valid shell path. /bin/zsh is the macOS default; defaultShell wins when set.
    const shell = s.settings.defaultShell || '/bin/zsh'
    const tabId = crypto.randomUUID()
    // shell -l -c "<cmd>" so the user's login profile (PATH, fnm, nvm) applies — bare exec
    // of `bun dev` from Electron's env won't find user-installed tooling on most setups.
    const ptyId = await window.api.pty.create(
      ws.worktreePath,
      shell,
      { AGENT_ORCH_WS_ID: ws.id },
      [shell, '-l', '-c', command],
    )
    get().addTab({
      id: tabId,
      workspaceId: ws.id,
      type: 'service',
      title: scriptName,
      ptyId,
      scriptName,
      command,
      status: 'running',
    })
    // Append to projectStartupSettings (dedupe by command) so the Recent list survives quit.
    const project = get().projects.find((p) => p.id === ws.projectId)
    if (project) {
      try {
        const existing = (await window.api.projectStartupSettings.get(project.repoPath)) ?? []
        if (!existing.some((e) => e.command === command)) {
          await window.api.projectStartupSettings.set(project.repoPath, [
            ...existing,
            { name: scriptName, command },
          ])
        }
      } catch {
        // Best-effort persistence; service still launches in-session.
      }
    }
  },

  restartService: async (tabId) => {
    const s = get()
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab || tab.type !== 'service') return
    const ws = s.workspaces.find((w) => w.id === tab.workspaceId)
    if (!ws) return
    window.api.pty.destroy(tab.ptyId)
    // Renderer can't see process.env.SHELL under contextIsolation; main resolves `${shell} -l -c …`,
    // so we just need *some* valid shell path. /bin/zsh is the macOS default; defaultShell wins when set.
    const shell = s.settings.defaultShell || '/bin/zsh'
    const newPtyId = await window.api.pty.create(
      ws.worktreePath,
      shell,
      { AGENT_ORCH_WS_ID: ws.id },
      [shell, '-l', '-c', tab.command],
    )
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === 'service'
          ? { ...t, ptyId: newPtyId, status: 'running', exitCode: undefined }
          : t,
      ),
    }))
  },

  stopService: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab || tab.type !== 'service') return
    window.api.pty.destroy(tab.ptyId)
    // PTY_EXIT broadcast flips status; no optimistic update so we don't race the real exit code.
  },

  createTerminalForActiveWorkspace: async () => {
    const s = get()
    if (!s.activeWorkspaceId) return
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    if (!ws) return

    const shell = s.settings.defaultShell || undefined
    const tabId = crypto.randomUUID()
    console.info('[terminal:create]', 'creating PTY for active workspace', {
      workspaceId: ws.id,
      worktreePath: ws.worktreePath,
      tabId,
    })
    const ptyId = await window.api.pty.create(ws.worktreePath, shell, { AGENT_ORCH_WS_ID: ws.id })
    const livePtys = new Set(await window.api.pty.list().catch(() => [] as string[]))
    if (!livePtys.has(ptyId)) {
      console.warn('[terminal:create]', 'created PTY was not present in live list', {
        workspaceId: ws.id,
        ptyId,
        tabId,
        livePtyCount: livePtys.size,
      })
    }
    const latest = get()
    const workspaceId = ws.id
    const wsTabs = latest.tabs.filter((t) => t.workspaceId === workspaceId)
    const termCount = wsTabs.filter((t) => t.type === 'terminal').length

    get().addTab({
      id: tabId,
      workspaceId,
      type: 'terminal',
      title: `Terminal ${termCount + 1}`,
      ptyId,
    })
  },

  createPiThreadForActiveWorkspace: async () => {
    const s = get()
    if (!s.activeWorkspaceId) return
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    if (!ws) return

    const wsTabs = s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
    const piCount = wsTabs.filter((t) => t.type === 'pi-thread').length
    const fallbackTitle = piCount === 0 ? 'PI Chat' : `PI Chat ${piCount + 1}`

    const tabId = crypto.randomUUID()
    try {
      let piState = (await window.api.pi.syncWorkspace(ws.worktreePath, ws.name)) as DesktopAppState
      const piWs =
        piState.workspaces.find((w) => pathsEqualOrAlias(w.path, ws.worktreePath)) ??
        piState.workspaces.find((w) => ws.worktreePath.startsWith(w.path)) ??
        piState.workspaces.find((w) => w.path.startsWith(ws.worktreePath))

      if (!piWs) {
        get().addTab({
          id: tabId,
          workspaceId: s.activeWorkspaceId,
          type: 'pi-thread',
          title: fallbackTitle,
        })
        return
      }

      piState = (await window.api.pi.createSession({ workspaceId: piWs.id })) as DesktopAppState
      const sessionId = piState.selectedSessionId
      const updatedWs = piState.workspaces.find((w) => w.id === piWs.id)
      const sess = updatedWs?.sessions.find((x) => x.id === sessionId)
      const title = sess?.title?.trim() ? sess.title.trim() : fallbackTitle

      get().addTab({
        id: tabId,
        workspaceId: s.activeWorkspaceId,
        type: 'pi-thread',
        title,
        piSessionId: sessionId || undefined,
        piSessionTitle: sess?.title,
      })
    } catch {
      get().addTab({
        id: tabId,
        workspaceId: s.activeWorkspaceId,
        type: 'pi-thread',
        title: fallbackTitle,
      })
    }
  },

  setPiThreadSessionBinding: (tabId, piSessionId, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === 'pi-thread'
          ? {
              ...t,
              piSessionId,
              ...(title !== undefined
                ? { title, piSessionTitle: title }
                : {}),
            }
          : t,
      ),
    })),

  createConductorTabForActiveWorkspace: () => {
    const s = get()
    if (!s.activeWorkspaceId) return
    const conductorCount = s.tabs.filter(
      (t) => t.workspaceId === s.activeWorkspaceId && t.type === 'conductor',
    ).length
    const title = conductorCount === 0 ? 'New chat' : `New chat ${conductorCount + 1}`
    get().addTab({
      id: crypto.randomUUID(),
      workspaceId: s.activeWorkspaceId,
      type: 'conductor',
      title,
    })
    set({
      settingsOpen: false,
      automationsOpen: false,
      linearPanelOpen: false,
      linearQuickOpenVisible: false,
    })
  },

  setConductorTabSessionBinding: (tabId, agentSessionId, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === 'conductor'
          ? {
              ...t,
              agentSessionId,
              ...(title !== undefined ? { title } : {}),
            }
          : t,
      ),
    })),

  openConductorSessionTab: (agentSessionId, title) => {
    const s = get()
    if (!s.activeWorkspaceId) return
    get().addTab({
      id: crypto.randomUUID(),
      workspaceId: s.activeWorkspaceId,
      type: 'conductor',
      title: title?.trim() || 'New chat',
      agentSessionId,
    })
    set({
      settingsOpen: false,
      automationsOpen: false,
      linearPanelOpen: false,
      linearQuickOpenVisible: false,
    })
  },

  launchAgentTerminalWithCommand: async (opts) => {
    const { workspaceId, worktreePath, title, command, agentType } = opts

    if (agentType === 'claude-code') {
      await window.api.claude.trustPath(worktreePath).catch(() => {})
    }

    const shell = get().settings.defaultShell || undefined
    const ptyId = await window.api.pty.create(worktreePath, shell, {
      AGENT_ORCH_WS_ID: workspaceId,
      AGENT_ORCH_AGENT_TYPE: agentType,
    })

    const tabId = crypto.randomUUID()
    get().addTab({
      id: tabId,
      workspaceId,
      type: 'terminal',
      title,
      ptyId,
      agentType,
    })

    setTimeout(() => {
      window.api.pty.write(ptyId, command + '\n')
    }, 500)

    return tabId
  },

  startLinearIssueAgentSession: async (issue) => {
    const addToast = get().addToast
    if (linearIssueAgentLaunchInFlight.has(issue.id)) return
    linearIssueAgentLaunchInFlight.add(issue.id)

    addToast({
      id: crypto.randomUUID(),
      type: 'info',
      message: `Starting agent for ${issue.identifier}…`,
    })

    const activeWorkspaceId = get().activeWorkspaceId
    const workspace = activeWorkspaceId
      ? get().workspaces.find((w) => w.id === activeWorkspaceId)
      : undefined
    const project = workspace ? get().projects.find((p) => p.id === workspace.projectId) : undefined

    if (!workspace || !project) {
      linearIssueAgentLaunchInFlight.delete(issue.id)
      addToast({
        id: crypto.randomUUID(),
        type: 'error',
        message: 'Open a workspace for this repository first, then try again.',
      })
      return
    }

    const settings = get().settings
    const agent = normalizeLinearIssueCodingAgent(settings.linearIssueCodingAgent)
    const model =
      normalizeLinearIssueCodingModel(settings.linearIssueCodingModel).trim() || null

    const wtName = linearIssueWorktreeDirectoryName(issue)
    const branch = linearIssueAgentBranchName(issue)
    const repoPath = project.repoPath

    const progressRes = await linearIssueMoveToInProgress(settings.linearApiKey, issue)
    if (!progressRes.ok) {
      const detail =
        progressRes.error === 'missing_team_id'
          ? 'issue has no team in the API response — refresh issues from Linear'
          : progressRes.error === 'no_in_progress_state'
            ? 'no matching In Progress workflow state for this team'
            : progressRes.error
      addToast({
        id: crypto.randomUUID(),
        type: 'info',
        message: `Could not move ${issue.identifier} to In Progress (${detail}). Continuing…`,
      })
    }

    let worktreePath: string
    try {
      worktreePath = await window.api.git.createWorktree(
        repoPath,
        wtName,
        branch,
        true,
        undefined,
        false,
        undefined,
        settings.worktreeCredentialRules,
      )
    } catch (err) {
      linearIssueAgentLaunchInFlight.delete(issue.id)
      const msg = err instanceof Error ? err.message : 'Failed to create worktree'
      addToast({ id: crypto.randomUUID(), type: 'error', message: msg })
      return
    }

    const createdBranch = await window.api.git.getCurrentBranch(worktreePath).catch(() => branch)
    const wsId = crypto.randomUUID()
    const wsTitle = `${issue.identifier}: ${issue.title}`.slice(0, 120)

    get().addWorkspace({
      id: wsId,
      name: wsTitle,
      branch: createdBranch,
      worktreePath,
      projectId: project.id,
      linearIssueId: issue.id,
    })

    const prompt = formatLinearIssueAgentPrompt(issue)
    const { command } = buildAdHocAgentCommand(agent, model, prompt)
    const agentType = planAgentToPtyAgentType(agent)

    try {
      await get().launchAgentTerminalWithCommand({
        workspaceId: wsId,
        worktreePath,
        title: `${issue.identifier} · agent`,
        command,
        agentType: agentType as AgentType,
      })
      addToast({
        id: crypto.randomUUID(),
        type: 'info',
        message: `Agent running in new workspace for ${issue.identifier}`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start agent'
      addToast({ id: crypto.randomUUID(), type: 'error', message: msg })
    } finally {
      linearIssueAgentLaunchInFlight.delete(issue.id)
    }
  },

  closeActiveTab: () => {
    const s = get()
    if (!s.activeTabId) return
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    if (!tab) return
    if (tab.type === 'file' && tab.unsaved && s.settings.confirmOnClose) {
      if (!window.confirm('This file has unsaved changes. Close anyway?')) return
    }
    if (tab.type === 'terminal') {
      // Destroy all PTYs: backing PTY + any in the split tree
      const ptyIds = new Set(tab.splitRoot ? getAllPtyIds(tab.splitRoot) : [])
      ptyIds.add(tab.ptyId)
      ptyIds.forEach((id) => window.api.pty.destroy(id))
    }
    if (tab.type === 'file' && tab.splitRoot) {
      getAllPtyIds(tab.splitRoot).forEach((id) => window.api.pty.destroy(id))
    }
    get().removeTab(tab.id)
  },

  setTabUnsaved: (tabId, unsaved) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.type === 'file' ? { ...t, unsaved } : t
      ),
    })),

  notifyTabSaved: (tabId) => {
    set({ lastSavedTabId: tabId })
    setTimeout(() => {
      if (get().lastSavedTabId === tabId) set({ lastSavedTabId: null })
    }, 1200)
  },

  openFileTab: (filePath, opts) => {
    const s = get()
    if (!s.activeWorkspaceId) return
    const initialPosition = opts?.initialPosition
    const existing = s.tabs.find(
      (t) => t.workspaceId === s.activeWorkspaceId && t.type === 'file' && t.filePath === filePath
    )
    if (existing) {
      if (initialPosition) {
        set({
          activeTabId: existing.id,
          tabs: s.tabs.map((t) =>
            t.id === existing.id && t.type === 'file' ? { ...t, initialPosition } : t
          ),
        })
      } else {
        set({ activeTabId: existing.id })
      }
      return
    }
    get().addTab({
      id: crypto.randomUUID(),
      workspaceId: s.activeWorkspaceId,
      type: 'file',
      filePath,
      ...(initialPosition ? { initialPosition } : {}),
    })
  },

  clearFileTabInitialPosition: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId || t.type !== 'file' || !t.initialPosition) return t
        const { initialPosition: _drop, ...rest } = t
        return rest
      }),
    }))
  },

  openMarkdownPreview: (filePath) => {
    const s = get()
    if (!s.activeWorkspaceId) return
    const existing = s.tabs.find(
      (t) => t.workspaceId === s.activeWorkspaceId && t.type === 'markdownPreview' && t.filePath === filePath
    )
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    const title = filePath.split('/').pop() || 'Preview'
    get().addTab({
      id: crypto.randomUUID(),
      workspaceId: s.activeWorkspaceId,
      type: 'markdownPreview',
      filePath,
      title,
    })
  },

  openFullFileDiffTab: (filePath, opts) => {
    const s = get()
    if (!s.activeWorkspaceId) return
    const originalRef = opts?.originalRef ?? 'HEAD'
    const existing = s.tabs.find(
      (t) =>
        t.workspaceId === s.activeWorkspaceId &&
        t.type === 'fileDiff' &&
        t.filePath === filePath &&
        (t.originalRef ?? 'HEAD') === originalRef
    )
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    get().addTab({
      id: crypto.randomUUID(),
      workspaceId: s.activeWorkspaceId,
      type: 'fileDiff',
      filePath,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.originalRef ? { originalRef: opts.originalRef } : {}),
    })
  },

  retargetPlanFilePathEverywhere: (oldPath, newPath) => {
    if (oldPath === newPath) return
    const previewTitle = newPath.split('/').pop() || 'Preview'
    set((s) => {
      let planBuildTerminalByPlanPath = { ...s.planBuildTerminalByPlanPath }
      const terminalTabId = planBuildTerminalByPlanPath[oldPath]
      if (terminalTabId !== undefined) {
        delete planBuildTerminalByPlanPath[oldPath]
        planBuildTerminalByPlanPath[newPath] = terminalTabId
      }

      const tabs = s.tabs.map((t) => {
        if (t.type === 'markdownPreview' && t.filePath === oldPath) {
          return { ...t, filePath: newPath, title: previewTitle }
        }
        if (t.type === 'file') {
          const nextPath = t.filePath === oldPath ? newPath : t.filePath
          const nextSplit = t.splitRoot
            ? retargetFilePathInSplitRoot(t.splitRoot, oldPath, newPath)
            : undefined
          if (nextPath !== t.filePath || nextSplit !== t.splitRoot) {
            return { ...t, filePath: nextPath, splitRoot: nextSplit }
          }
        }
        if (t.type === 'terminal' && t.splitRoot) {
          const nextSplit = retargetFilePathInSplitRoot(t.splitRoot, oldPath, newPath)
          if (nextSplit !== t.splitRoot) {
            return { ...t, splitRoot: nextSplit }
          }
        }
        return t
      })

      return { planBuildTerminalByPlanPath, tabs }
    })
  },

  setPlanBuildTerminalForPlan: (planPath, terminalTabId) =>
    set((s) => ({
      planBuildTerminalByPlanPath: { ...s.planBuildTerminalByPlanPath, [planPath]: terminalTabId },
    })),

  openLatestAgentPlan: async () => {
    const s = get()
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    if (!ws) {
      s.addToast({
        id: crypto.randomUUID(),
        message: 'Select a workspace first',
        type: 'info',
      })
      return
    }
    try {
      const projectPaths = s.workspaces
        .filter((w) => w.projectId === ws.projectId)
        .map((w) => w.worktreePath)
        .filter((p): p is string => Boolean(p))
      const scanArg = projectPaths.length <= 1 ? (projectPaths[0] ?? ws.worktreePath) : projectPaths
      const path = await window.api.fs.findNewestPlanMarkdown(scanArg)
      if (!path) {
        s.addToast({
          id: crypto.randomUUID(),
          message: `No plan files found. Expected .md/.mdx under ${AGENT_PLAN_DIRS_LABEL} in the workspace, or the same folders under your home directory (e.g. ~/.claude/plans or ~/.pi-constell/plans).`,
          type: 'info',
        })
        return
      }
      get().openMarkdownPreview(path)
    } catch (err) {
      if (maybeShowStaleMainToast(err, s.addToast)) {
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      s.addToast({ id: crypto.randomUUID(), message: msg, type: 'error' })
    }
  },

  nextWorkspace: () => {
    const s = get()
    const ordered = getVisibleWorkspaces(s.projects, s.workspaces, s.collapsedProjectIds)
    if (ordered.length <= 1) return
    const idx = ordered.findIndex((workspace) => workspace.id === s.activeWorkspaceId)
    const next = idx === -1 ? ordered[0] : ordered[(idx + 1) % ordered.length]
    if (next) get().setActiveWorkspace(next.id)
  },

  prevWorkspace: () => {
    const s = get()
    const ordered = getVisibleWorkspaces(s.projects, s.workspaces, s.collapsedProjectIds)
    if (ordered.length <= 1) return
    const idx = ordered.findIndex((workspace) => workspace.id === s.activeWorkspaceId)
    const prev = idx === -1 ? ordered[ordered.length - 1] : ordered[(idx - 1 + ordered.length) % ordered.length]
    if (prev) get().setActiveWorkspace(prev.id)
  },

  nextWorkspaceInActiveProject: () => {
    const s = get()
    const active = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    if (!active) return
    const ordered = getRenderableProjectWorkspaces(s.workspaces, active.projectId)
    if (ordered.length <= 1) return
    const idx = ordered.findIndex((w) => w.id === s.activeWorkspaceId)
    const next = idx === -1 ? ordered[0] : ordered[(idx + 1) % ordered.length]
    if (next) get().setActiveWorkspace(next.id)
  },

  prevWorkspaceInActiveProject: () => {
    const s = get()
    const active = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    if (!active) return
    const ordered = getRenderableProjectWorkspaces(s.workspaces, active.projectId)
    if (ordered.length <= 1) return
    const idx = ordered.findIndex((w) => w.id === s.activeWorkspaceId)
    const prev = idx === -1 ? ordered[ordered.length - 1] : ordered[(idx - 1 + ordered.length) % ordered.length]
    if (prev) get().setActiveWorkspace(prev.id)
  },

  switchToProjectByIndex: (index) => {
    const s = get()
    const orderedProjects = getSwitchableVisibleProjects(
      s.projects,
      s.workspaces,
      s.lastActiveWorkspaceByProjectId,
    )
    const project = orderedProjects[index]
    if (!project) return
    const target = resolveSidebarProjectTargetWorkspace(
      project.id,
      s.workspaces,
      s.lastActiveWorkspaceByProjectId,
    )
    if (target) get().setActiveWorkspace(target.id)
  },

  switchToTabByIndex: (index) => {
    const s = get()
    const wsTabs = s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
    if (index >= 0 && index < wsTabs.length) {
      set({ activeTabId: wsTabs[index].id })
    }
  },

  closeAllWorkspaceTabs: () => {
    const s = get()
    if (!s.activeWorkspaceId) return
    const wsTabs = s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
    const hasUnsaved = wsTabs.some((t) => t.type === 'file' && t.unsaved)
    if (hasUnsaved && !window.confirm('Close all tabs? Some have unsaved changes.')) return
    wsTabs.forEach((t) => {
      if (t.type === 'terminal') {
        const ptyIds = new Set(t.splitRoot ? getAllPtyIds(t.splitRoot) : [])
        ptyIds.add(t.ptyId)
        ptyIds.forEach((id) => window.api.pty.destroy(id))
      }
    })
    const wsId = s.activeWorkspaceId
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.workspaceId !== wsId)
      return {
        tabs: newTabs,
        activeTabId: null,
        planBuildTerminalByPlanPath: planBuildMapForTabs(state.planBuildTerminalByPlanPath, newTabs),
      }
    })
  },

  focusOrCreateTerminal: async () => {
    const s = get()
    if (!s.activeWorkspaceId) return
    const wsTabs = s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
    const termTab = wsTabs.find((t) => t.type === 'terminal')
    if (termTab) {
      set({ activeTabId: termTab.id })
    } else {
      await get().createTerminalForActiveWorkspace()
    }
  },

  splitTerminalPaneForTab: async (tabId, direction) => {
    const s = get()
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return

    set({ activeTabId: tabId })

    const ws = s.workspaces.find((w) => w.id === tab.workspaceId)
    if (!ws) return

    const shell = s.settings.defaultShell || undefined

    // File tab — convert to a split container with file + terminal panes
    if (tab.type === 'file') {
      const backingPtyId = await window.api.pty.create(ws.worktreePath, shell, { AGENT_ORCH_WS_ID: ws.id })
      const newPtyId = await window.api.pty.create(ws.worktreePath, shell, { AGENT_ORCH_WS_ID: ws.id })
      const newLeafId = crypto.randomUUID()

      const currentRoot: SplitNode = tab.splitRoot ?? {
        type: 'leaf' as const,
        id: crypto.randomUUID(),
        contentType: 'file' as const,
        filePath: tab.filePath,
      }
      const targetPaneId = tab.splitRoot
        ? (tab.focusedPaneId ?? firstLeaf(tab.splitRoot).id)
        : currentRoot.id
      const newLeaf = { type: 'leaf' as const, id: newLeafId, contentType: 'terminal' as const, ptyId: newPtyId }
      const splitRoot = splitLeaf(currentRoot, targetPaneId, direction, newLeaf)

      const fileName = tab.filePath.split('/').pop() || 'Split'
      const id = tab.id
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id
            ? {
                id,
                workspaceId: t.workspaceId,
                type: 'terminal' as const,
                title: fileName,
                ptyId: backingPtyId,
                splitRoot,
                focusedPaneId: newLeafId,
              }
            : t
        ),
        activeTabId: id,
      }))
      return
    }

    // Markdown preview tab — convert to a split container with file editor + terminal panes
    if (tab.type === 'markdownPreview') {
      const backingPtyId = await window.api.pty.create(ws.worktreePath, shell, { AGENT_ORCH_WS_ID: ws.id })
      const newPtyId = await window.api.pty.create(ws.worktreePath, shell, { AGENT_ORCH_WS_ID: ws.id })
      const newLeafId = crypto.randomUUID()

      const currentRoot: SplitNode = {
        type: 'leaf' as const,
        id: crypto.randomUUID(),
        contentType: 'file' as const,
        filePath: tab.filePath,
      }
      const newLeaf = { type: 'leaf' as const, id: newLeafId, contentType: 'terminal' as const, ptyId: newPtyId }
      const splitRoot = splitLeaf(currentRoot, currentRoot.id, direction, newLeaf)

      const fileName = tab.filePath.split('/').pop() || 'Split'
      const id = tab.id
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id
            ? {
                id,
                workspaceId: t.workspaceId,
                type: 'terminal' as const,
                title: fileName,
                ptyId: backingPtyId,
                splitRoot,
                focusedPaneId: newLeafId,
              }
            : t
        ),
        activeTabId: id,
      }))
      return
    }

    if (tab.type !== 'terminal') return

    const newPtyId = await window.api.pty.create(ws.worktreePath, shell, { AGENT_ORCH_WS_ID: ws.id })
    const newLeafId = crypto.randomUUID()

    // Build the split tree: if no splitRoot yet, create one from the existing single pane
    const currentRoot = tab.splitRoot ?? { type: 'leaf' as const, id: tab.id, contentType: 'terminal' as const, ptyId: tab.ptyId }
    const targetPaneId = tab.focusedPaneId ?? (currentRoot.type === 'leaf' ? currentRoot.id : firstLeaf(currentRoot).id)
    const newLeaf = { type: 'leaf' as const, id: newLeafId, contentType: 'terminal' as const, ptyId: newPtyId }
    const newRoot = splitLeaf(currentRoot, targetPaneId, direction, newLeaf)

    // Keep keyboard/focus on the pane that was split (existing session), not the new empty PTY.
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tab.id && t.type === 'terminal'
          ? { ...t, splitRoot: newRoot, focusedPaneId: targetPaneId }
          : t
      ),
    }))
  },

  splitTerminalPane: async (direction) => {
    const id = get().activeTabId
    if (!id) return
    await get().splitTerminalPaneForTab(id, direction)
  },

  openFileInSplit: async (filePath, direction = 'horizontal') => {
    const s = get()
    if (!s.activeWorkspaceId) return

    let tab = s.tabs.find((t) => t.id === s.activeTabId)

    // Active tab is a file tab — add a pane (stay `file` when already split; else convert to terminal tab)
    if (tab && tab.type === 'file') {
      const ws = s.workspaces.find((w) => w.id === tab!.workspaceId)
      if (!ws) return

      if (tab.splitRoot) {
        const newLeafId = crypto.randomUUID()
        const newLeaf = { type: 'leaf' as const, id: newLeafId, contentType: 'file' as const, filePath }
        const currentRoot = tab.splitRoot
        const targetPaneId = tab.focusedPaneId ?? (currentRoot.type === 'leaf' ? currentRoot.id : firstLeaf(currentRoot).id)
        const newRoot = splitLeaf(currentRoot, targetPaneId, direction, newLeaf)
        const tabId = tab.id
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId && t.type === 'file'
              ? { ...t, splitRoot: newRoot, focusedPaneId: newLeafId }
              : t
          ),
          activeTabId: tabId,
        }))
        return
      }

      // Create a backing PTY (required by the terminal tab type)
      const shell = s.settings.defaultShell || undefined
      const backingPtyId = await window.api.pty.create(ws.worktreePath, shell, { AGENT_ORCH_WS_ID: ws.id })

      const originalLeafId = crypto.randomUUID()
      const newLeafId = crypto.randomUUID()
      const originalFilePath = tab.filePath

      const splitRoot = {
        type: 'split' as const,
        id: crypto.randomUUID(),
        direction,
        children: [
          { type: 'leaf' as const, id: originalLeafId, contentType: 'file' as const, filePath: originalFilePath },
          { type: 'leaf' as const, id: newLeafId, contentType: 'file' as const, filePath },
        ] as [SplitNode, SplitNode],
      }

      const fileName = originalFilePath.split('/').pop() || 'Split'
      const tabId = tab.id
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                id: tabId,
                workspaceId: t.workspaceId,
                type: 'terminal' as const,
                title: fileName,
                ptyId: backingPtyId,
                splitRoot,
                focusedPaneId: newLeafId,
              }
            : t
        ),
        activeTabId: tabId,
      }))
      return
    }

    // Find the active terminal tab, or fall back to the first terminal tab in this workspace
    if (!tab || tab.type !== 'terminal') {
      tab = s.tabs.find((t) => t.workspaceId === s.activeWorkspaceId && t.type === 'terminal')
    }

    // No terminal tab exists — create one first so we have a pane to split with
    if (!tab || tab.type !== 'terminal') {
      await get().createTerminalForActiveWorkspace()
      const updated = get()
      tab = updated.tabs.find((t) => t.id === updated.activeTabId)
      if (!tab || tab.type !== 'terminal') return
    }

    const newLeafId = crypto.randomUUID()
    const newLeaf = { type: 'leaf' as const, id: newLeafId, contentType: 'file' as const, filePath }

    // Build the split tree: if no splitRoot yet, create one from the existing single pane
    const currentRoot = tab.splitRoot ?? { type: 'leaf' as const, id: tab.id, contentType: 'terminal' as const, ptyId: tab.ptyId }
    const targetPaneId = tab.focusedPaneId ?? (currentRoot.type === 'leaf' ? currentRoot.id : firstLeaf(currentRoot).id)
    const newRoot = splitLeaf(currentRoot, targetPaneId, direction, newLeaf)

    const tabId = tab.id
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === 'terminal'
          ? { ...t, splitRoot: newRoot, focusedPaneId: newLeafId }
          : t
      ),
      activeTabId: tabId,
    }))
  },

  cycleFocusedPane: () => {
    const s = get()
    if (!s.activeTabId) return
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    if (!tab || (tab.type !== 'terminal' && tab.type !== 'file')) return
    if (!tab.splitRoot) return
    const leaves = collectLeaves(tab.splitRoot)
    if (leaves.length <= 1) return
    const idx = leaves.findIndex((l) => l.id === tab.focusedPaneId)
    const next = leaves[(idx + 1) % leaves.length]
    get().setFocusedPane(tab.id, next.id)
  },

  setFocusedPane: (tabId, paneId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t
        if (t.type === 'terminal') return { ...t, focusedPaneId: paneId }
        if (t.type === 'file' && t.splitRoot) return { ...t, focusedPaneId: paneId }
        return t
      }),
    })),

  closeSplitPane: (paneId) => {
    const s = get()
    if (!s.activeTabId) return
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    if (!tab || (tab.type !== 'terminal' && tab.type !== 'file')) return
    if (!tab.splitRoot) return

    const leaf = findLeaf(tab.splitRoot, paneId)
    if (!leaf) return
    if (leaf.contentType === 'terminal') {
      window.api.pty.destroy(leaf.ptyId)
    }

    const newRoot = removeLeaf(tab.splitRoot, paneId)
    if (!newRoot) {
      if (tab.type === 'terminal') {
        window.api.pty.destroy(tab.ptyId)
      }
      get().removeTab(tab.id)
      return
    }

    const isSingleLeaf = newRoot.type === 'leaf'

    if (tab.type === 'file') {
      if (isSingleLeaf && newRoot.type === 'leaf' && newRoot.contentType === 'file') {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tab.id && t.type === 'file'
              ? { ...t, filePath: newRoot.filePath, splitRoot: undefined, focusedPaneId: undefined }
              : t
          ),
        }))
        return
      }
      const newFocused = firstLeaf(newRoot).id
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tab.id && t.type === 'file'
            ? { ...t, splitRoot: newRoot, focusedPaneId: newFocused }
            : t
        ),
      }))
      return
    }

    // Collapsed to a single file leaf → open file as standalone tab, close terminal tab
    if (isSingleLeaf && newRoot.type === 'leaf' && newRoot.contentType === 'file') {
      const filePath = newRoot.filePath
      const workspaceId = tab.workspaceId
      // Destroy the tab's primary PTY if it's still alive (it may already be destroyed)
      // getAllPtyIds from the *original* tree minus the removed leaf gives us the surviving PTYs
      const survivingPtyIds = getAllPtyIds(newRoot)
      // Also destroy tab.ptyId if it wasn't already destroyed
      if (leaf.contentType !== 'terminal' || leaf.ptyId !== tab.ptyId) {
        // tab.ptyId is still alive — destroy it
        window.api.pty.destroy(tab.ptyId)
      }
      survivingPtyIds.forEach((id) => window.api.pty.destroy(id))

      get().removeTab(tab.id)
      // Open the file as a standalone file tab
      if (!get().tabs.some((t) => t.workspaceId === workspaceId && t.type === 'file' && t.filePath === filePath)) {
        get().addTab({
          id: crypto.randomUUID(),
          workspaceId,
          type: 'file',
          filePath,
        })
      } else {
        // File tab already open — just switch to it
        const existing = get().tabs.find(
          (t) => t.workspaceId === workspaceId && t.type === 'file' && t.filePath === filePath
        )
        if (existing) set({ activeTabId: existing.id })
      }
      return
    }

    // Collapsed to a single terminal leaf → promote as primary PTY, clear split
    if (isSingleLeaf && newRoot.type === 'leaf' && newRoot.contentType === 'terminal') {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tab.id && t.type === 'terminal'
            ? { ...t, ptyId: newRoot.ptyId, splitRoot: undefined, focusedPaneId: undefined }
            : t
        ),
      }))
      return
    }

    // Multiple panes remain — keep the split tree
    const newFocused = firstLeaf(newRoot).id

    // If the destroyed pane's PTY matched tab.ptyId, promote another terminal's PTY
    // so tab.ptyId always references a live process
    let promotedPtyId = tab.ptyId
    if (leaf.contentType === 'terminal' && leaf.ptyId === tab.ptyId) {
      const nextTerminal = firstTerminalLeaf(newRoot)
      if (nextTerminal) promotedPtyId = nextTerminal.ptyId
    }

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tab.id && t.type === 'terminal'
          ? { ...t, ptyId: promotedPtyId, splitRoot: newRoot, focusedPaneId: newFocused }
          : t
      ),
    }))
  },

  mergeTabIntoSplit: (sourceTabId, targetTabId, direction = 'horizontal') => {
    const s = get()
    if (sourceTabId === targetTabId) return

    const sourceTab = s.tabs.find((t) => t.id === sourceTabId)
    const targetTab = s.tabs.find((t) => t.id === targetTabId)
    if (!sourceTab || !targetTab) return
    if (sourceTab.workspaceId !== targetTab.workspaceId) return

    const mergeable = (t: Tab) => t.type === 'terminal' || t.type === 'file'
    if (!mergeable(sourceTab) || !mergeable(targetTab)) return

    // Terminal-in-file would unmount PTYs when switching away from the file tab (only terminal tabs stay mounted).
    if (sourceTab.type === 'terminal' && targetTab.type === 'file') return

    const sourceTree = tabToSplitTree(sourceTab)
    const targetTree = tabToSplitTree(targetTab)
    if (!sourceTree || !targetTree) return

    const newRoot = graftTree(targetTree, sourceTree, direction)
    const focusedPaneId = firstLeaf(sourceTree).id

    const newPlanMap = { ...s.planBuildTerminalByPlanPath }
    if (sourceTab.type === 'terminal') {
      for (const [path, tabId] of Object.entries(newPlanMap)) {
        if (tabId === sourceTabId) newPlanMap[path] = targetTabId
      }
    }

    set((state) => ({
      tabs: state.tabs
        .filter((t) => t.id !== sourceTabId)
        .map((t) => {
          if (t.id !== targetTabId) return t
          if (t.type === 'terminal') {
            return { ...t, splitRoot: newRoot, focusedPaneId }
          }
          if (t.type === 'file') {
            return { ...t, splitRoot: newRoot, focusedPaneId, filePath: t.filePath }
          }
          return t
        }),
      activeTabId: state.activeTabId === sourceTabId ? targetTabId : state.activeTabId,
      planBuildTerminalByPlanPath: newPlanMap,
    }))
  },

  openWorkspaceDialog: (projectId) => set({ workspaceDialogProjectId: projectId }),

  deleteWorkspace: async (workspaceId) => {
    const s = get()
    const ws = s.workspaces.find((w) => w.id === workspaceId)
    if (!ws) return
    const project = s.projects.find((p) => p.id === ws.projectId)

    // If this workspace was spotlighting into the project repo root, release it
    // first — main process restores root state and deletes refs/spotlight/<wsId>.
    if (project && s.spotlightWorkspaceIdByProject[project.id] === workspaceId) {
      try {
        await window.api.spotlight.disable(project.id)
      } catch {}
      get().setSpotlightWorkspace(project.id, null)
    }

    // Destroy PTYs for this workspace (including backing PTYs and split panes)
    s.tabs.filter((t) => t.workspaceId === workspaceId && t.type === 'terminal').forEach((t) => {
      if (t.type === 'terminal') {
        const ptyIds = new Set(t.splitRoot ? getAllPtyIds(t.splitRoot) : [])
        ptyIds.add(t.ptyId)
        ptyIds.forEach((id) => window.api.pty.destroy(id))
      }
    })

    // Remove from state immediately so sidebar updates
    get().removeWorkspace(workspaceId)

    // Remove git worktree in background (skip if workspace uses the main repo directly)
    if (project && ws.worktreePath !== project.repoPath) {
      try {
        await window.api.git.removeWorktree(project.repoPath, ws.worktreePath)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to remove worktree'
        get().addToast({ id: crypto.randomUUID(), message: msg, type: 'error' })
      }
    }
  },

  updateProject: (id, partial) => {
    const existing = get().projects.find((project) => project.id === id)
    const repoPath = partial.repoPath ?? existing?.repoPath
    const normalizedStartupCommands =
      partial.startupCommands !== undefined
        ? normalizeHydratedStartupCommands(partial.startupCommands)
        : undefined

    if (repoPath && partial.startupCommands !== undefined) {
      if (normalizedStartupCommands) {
        void window.api.projectStartupSettings.set(repoPath, normalizedStartupCommands)
      } else {
        void window.api.projectStartupSettings.delete(repoPath)
      }
    }

    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id
          ? {
              ...p,
              ...partial,
              ...(partial.startupCommands !== undefined ? { startupCommands: normalizedStartupCommands } : {}),
            }
          : p,
      ),
    }))
  },

  deleteProject: async (projectId) => {
    const s = get()
    const project = s.projects.find((p) => p.id === projectId)
    if (!project) return
    const projectWorkspaces = s.workspaces.filter((w) => w.projectId === projectId)

    // Destroy PTYs and remove worktrees for all workspaces in this project
    for (const ws of projectWorkspaces) {
      s.tabs.filter((t) => t.workspaceId === ws.id && t.type === 'terminal').forEach((t) => {
        if (t.type === 'terminal') {
          const ptyIds = new Set(t.splitRoot ? getAllPtyIds(t.splitRoot) : [])
          ptyIds.add(t.ptyId)
          ptyIds.forEach((id) => window.api.pty.destroy(id))
        }
      })
      if (ws.worktreePath !== project.repoPath) {
        try {
          await window.api.git.removeWorktree(project.repoPath, ws.worktreePath)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to remove worktree'
          get().addToast({ id: crypto.randomUUID(), message: msg, type: 'error' })
        }
      }
    }

    get().removeProject(projectId)
  },

  updateSettings: (partial) =>
    set((s) => ({ settings: { ...s.settings, ...partial } })),

  updateComposioWebhook: (partial) =>
    set((s) => ({
      composioWebhook: { ...s.composioWebhook, ...partial },
    })),

  toggleSettings: () =>
    set((s) => ({
      settingsOpen: !s.settingsOpen,
      automationsOpen: false,
      linearPanelOpen: false,
      linearQuickOpenVisible: false,
    })),

  setSettingsSection: (section) => set({ settingsSection: section }),

  openSettingsSection: (section) =>
    set({
      settingsOpen: true,
      settingsSection: section,
      automationsOpen: false,
      linearPanelOpen: false,
      linearQuickOpenVisible: false,
    }),
  toggleAutomations: () =>
    set((s) => ({
      automationsOpen: !s.automationsOpen,
      settingsOpen: false,
      linearPanelOpen: false,
      linearQuickOpenVisible: false,
    })),
  toggleLinear: () =>
    set((s) => {
      const nextOpen = !s.linearPanelOpen
      return {
        linearPanelOpen: nextOpen,
        settingsOpen: false,
        automationsOpen: false,
        linearQuickOpenVisible: nextOpen ? s.linearQuickOpenVisible : false,
      }
    }),

  showConfirmDialog: (dialog) => set({ confirmDialog: dialog }),

  updateConfirmDialog: (partial) => set((s) => ({
    confirmDialog: s.confirmDialog ? { ...s.confirmDialog, ...partial } : null,
  })),

  dismissConfirmDialog: () => set({ confirmDialog: null }),

  addToast: (toast) =>
    set((s) => ({ toasts: [...s.toasts, toast] })),

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  toggleQuickOpen: () => set((s) => {
    const nextVisible = !s.quickOpenVisible
    return {
      quickOpenVisible: nextVisible,
      planPaletteVisible: false,
      changesFileFind: nextVisible ? null : s.changesFileFind,
      // Plain toggle never enters editor-find mode; clear on both sides so a
      // palette that was opened from the editor can be re-toggled into normal
      // worktree mode, and so a re-open doesn't re-seed stale editor state.
      editorFindContext: null,
      quickOpenInitialQuery: null,
    }
  }),
  closeQuickOpen: () => set({
    quickOpenVisible: false,
    editorFindContext: null,
    quickOpenInitialQuery: null,
  }),
  openQuickOpenFromEditor: ({ filePath, initialQuery }) => set({
    quickOpenVisible: true,
    editorFindContext: { filePath },
    quickOpenInitialQuery: initialQuery && initialQuery.length > 0 ? initialQuery : null,
    planPaletteVisible: false,
    changesFileFind: null,
  }),
  openLinearQuickOpen: () =>
    set((s) => {
      if (!s.linearPanelOpen) return s
      return {
        linearQuickOpenVisible: true,
        quickOpenVisible: false,
        editorFindContext: null,
        quickOpenInitialQuery: null,
        changesFileFind: null,
        planPaletteVisible: false,
        settings: { ...s.settings, linearWorkspaceToolbarTool: 'search' as const },
      }
    }),
  closeLinearQuickOpen: () => set({ linearQuickOpenVisible: false }),
  openChangesFileFind: (payload) => set({
    changesFileFind: payload,
    quickOpenVisible: false,
    editorFindContext: null,
    quickOpenInitialQuery: null,
    planPaletteVisible: false,
  }),
  closeChangesFileFind: () => set({ changesFileFind: null }),
  togglePlanPalette: () => set((s) => ({
    planPaletteVisible: !s.planPaletteVisible,
    quickOpenVisible: false,
    editorFindContext: null,
    quickOpenInitialQuery: null,
    changesFileFind: null,
  })),
  closePlanPalette: () => set({ planPaletteVisible: false }),

  toggleHunkReview: async () => {
    const s = get()
    if (s.hunkReviewOpen) {
      set({ hunkReviewOpen: false, hunkReviewWorkspaceId: null })
      return
    }
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    if (!ws) return

    set({
      hunkReviewOpen: true,
      hunkReviewWorkspaceId: ws.id,
      quickOpenVisible: false,
      editorFindContext: null,
      quickOpenInitialQuery: null,
      planPaletteVisible: false,
      changesFileFind: null,
    })
  },
  closeHunkReview: () => set({ hunkReviewOpen: false, hunkReviewWorkspaceId: null }),
  submitHunkReview: async (selectedCommentIds?: Set<string>) => {
    const s = get()
    const ws = s.workspaces.find((w) => w.id === s.hunkReviewWorkspaceId)
    if (!ws) return
    try {
      const rows = await window.api.review.commentList(ws.worktreePath)
      const comments = rows.map((r) => ({
        id: r.id,
        file: r.file_path,
        newLine: r.side === 'new' ? r.line_start : undefined,
        oldLine: r.side === 'old' ? r.line_start : undefined,
        summary: r.summary,
        author: r.author ?? undefined,
      }))
      const formatted = formatReviewForAgent(comments, selectedCommentIds)
      if (!formatted) {
        s.addToast({ id: `review-empty-${Date.now()}`, message: 'No comments to submit', type: 'info' })
        return
      }
      const pty = resolveAgentPtyForContextInjection({
        tabs: s.tabs,
        activeTabId: s.activeTabId,
        activeWorkspaceId: s.hunkReviewWorkspaceId,
      })
      if (!pty) {
        s.addToast({ id: `review-no-pty-${Date.now()}`, message: 'No agent terminal found', type: 'error' })
        return
      }
      window.api.pty.write(pty, wrapBracketedPaste(formatted))
      s.addToast({ id: `review-sent-${Date.now()}`, message: 'Review submitted to agent', type: 'info' })
      set({ hunkReviewOpen: false, hunkReviewWorkspaceId: null })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit review'
      s.addToast({ id: `review-err-${Date.now()}`, message: msg, type: 'error' })
    }
  },

  markWorkspaceUnread: (workspaceId) =>
    set((s) => {
      if (s.unreadWorkspaceIds.has(workspaceId)) return s
      const newUnread = new Set(s.unreadWorkspaceIds)
      newUnread.add(workspaceId)
      return { unreadWorkspaceIds: newUnread }
    }),

  clearWorkspaceUnread: (workspaceId) =>
    set((s) => {
      if (!s.unreadWorkspaceIds.has(workspaceId)) return s
      const newUnread = new Set(s.unreadWorkspaceIds)
      newUnread.delete(workspaceId)
      return { unreadWorkspaceIds: newUnread }
    }),

  setActiveAgentWorkspaces: (entries) =>
    set((s) => {
      // Only drive sidebar "active" dots — never infer per-tab agent type from workspace-level
      // markers (same workspace can run Claude + Codex + others; that mis-titled the wrong tab).
      const newIds = new Set(entries.map((e) => e.wsId))
      const existing = s.activeClaudeWorkspaceIds
      if (newIds.size === existing.size) {
        let same = true
        for (const id of newIds) {
          if (!existing.has(id)) { same = false; break }
        }
        if (same) return {}
      }
      return { activeClaudeWorkspaceIds: newIds }
    }),

  setTerminalAgentType: (ptyId, agentType) =>
    set((s) => {
      let changed = false
      const tabs = s.tabs.map((tab) => {
        if (!terminalTabHasPtyId(tab, ptyId)) return tab
        if (tab.agentType === agentType) return tab
        changed = true
        const useAgentLabel =
          isGenericTerminalTitle(tab.title)
          || (agentType === 'gemini' && isGeminiIdleOscTitle(tab.title))
        const nextTitle = useAgentLabel ? (AGENT_NAMES[agentType] ?? tab.title) : tab.title
        return { ...tab, agentType, title: nextTitle }
      })
      if (changed) {
        console.log(TAB_TITLE_LOG, 'renderer setTerminalAgentType', { ptyId, agentType })
      }
      return changed ? { tabs } : {}
    }),

  updateTerminalTitle: (ptyId, title) =>
    set((s) => {
      let changed = false
      const tabs = s.tabs.map((tab) => {
        if (!terminalTabHasPtyId(tab, ptyId)) return tab
        const nextTitle =
          tab.agentType === 'gemini' && isGeminiIdleOscTitle(title)
            ? GEMINI_TAB_LABEL
            : title
        if (tab.title === nextTitle) return tab
        changed = true
        return { ...tab, title: nextTitle }
      })
      if (!changed) return {}
      console.log(TAB_TITLE_LOG, 'renderer updateTerminalTitle', { ptyId, title: title.slice(0, 80) })
      return { tabs }
    }),

  setActiveMonacoEditor: (editor) => set({ activeMonacoEditor: editor }),

  getFirstAgentTerminalPtyId: () => {
    const s = get()
    const wsTabs = s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)

    // Prefer the active tab if it's an agent terminal
    const activeTab = wsTabs.find((t) => t.id === s.activeTabId)
    if (activeTab?.type === 'terminal' && activeTab.agentType) {
      const ptyId = activeTab.focusedPaneId && activeTab.splitRoot
        ? getFocusedPtyId(activeTab.splitRoot, activeTab.focusedPaneId, activeTab.ptyId)
        : activeTab.ptyId
      return ptyId
    }

    // Fall back to first agent terminal tab
    const agentTab = wsTabs.find((t): t is Extract<Tab, { type: 'terminal' }> =>
      t.type === 'terminal' && !!t.agentType
    )
    if (agentTab) {
      return agentTab.ptyId
    }

    return undefined
  },

  sendContextToAgent: (snippets: ChatSnippet[]) => {
    const s = get()
    const sourcePath = snippets.find((x) => x.filePath)?.filePath
    const ptyId =
      resolvePtyForPlanSourceFilePath(
        sourcePath,
        s.planBuildTerminalByPlanPath,
        s.tabs,
        s.activeWorkspaceId,
      ) ?? s.getFirstAgentTerminalPtyId()
    if (!ptyId) {
      s.addToast({
        id: `no-agent-${Date.now()}`,
        message: 'No agent terminal found in this workspace',
        type: 'error',
      })
      return
    }

    // Format and send via bracketed paste
    const text = formatChatContext(snippets)
    window.api.pty.write(ptyId, wrapBracketedPaste(text))

    // Switch to the agent terminal tab
    const tab = s.tabs.find((t) =>
      t.type === 'terminal' && (t.ptyId === ptyId || (t.splitRoot && findLeafByPtyId(t.splitRoot, ptyId) != null))
    )
    if (tab) set({ activeTabId: tab.id })
  },

  setGitFileStatuses: (worktreePath, statuses) =>
    set((s) => {
      const m = new Map(s.gitFileStatuses)
      m.set(worktreePath, statuses)
      return { gitFileStatuses: m }
    }),

  updateGitStatusSnapshot: (worktreePath, snapshot) =>
    set((s) => {
      const nextSnapshots = new Map(s.workingTreeDiffSnapshots)
      const existing = nextSnapshots.get(worktreePath)
      nextSnapshots.set(
        worktreePath,
        existing && existing.signature === snapshot.signature
          ? { ...existing, ...snapshot }
          : { ...snapshot, files: [], complete: false },
      )
      return { workingTreeDiffSnapshots: nextSnapshots }
    }),

  setWorkingTreeDiffSnapshot: (worktreePath, snapshot) =>
    set((s) => {
      const nextSnapshots = new Map(s.workingTreeDiffSnapshots)
      if (snapshot) nextSnapshots.set(worktreePath, snapshot)
      else nextSnapshots.delete(worktreePath)
      return { workingTreeDiffSnapshots: nextSnapshots }
    }),

  setTabDeleted: (tabId, deleted) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.type === 'file' ? { ...t, deleted } : t
      ),
    })),

  setLastKnownRemoteHead: (projectId, hash) =>
    set((s) => ({
      lastKnownRemoteHead: { ...s.lastKnownRemoteHead, [projectId]: hash },
    })),

  setPrStatuses: (projectId, statuses) =>
    set((s) => {
      let changed = false
      const newMap = new Map(s.prStatusMap)
      for (const [branch, info] of Object.entries(statuses)) {
        const key = `${projectId}:${branch}`
        const prev = newMap.get(key)
        if (!prev || !info || prev.number !== info.number || prev.state !== info.state
          || prev.title !== info.title || prev.url !== info.url
          || prev.checkStatus !== info.checkStatus
          || prev.hasPendingComments !== info.hasPendingComments
          || prev.pendingCommentCount !== info.pendingCommentCount
          || prev.isBlockedByCi !== info.isBlockedByCi
          || prev.isApproved !== info.isApproved
          || prev.isChangesRequested !== info.isChangesRequested
          || prev.updatedAt !== info.updatedAt) {
          newMap.set(key, info)
          changed = true
        }
      }
      return changed ? { prStatusMap: newMap } : {}
    }),

  setGhAvailability: (projectId, available) =>
    set((s) => {
      if (s.ghAvailability.get(projectId) === available) return {}
      const newMap = new Map(s.ghAvailability)
      newMap.set(projectId, available)
      return { ghAvailability: newMap }
    }),

  setProjectDefaultBranch: (projectId, branch) =>
    set((s) => {
      const normalized = branch.trim()
      if (!normalized) return {}
      if (s.defaultBranchByProjectId.get(projectId) === normalized) return {}
      const next = new Map(s.defaultBranchByProjectId)
      next.set(projectId, normalized)
      return { defaultBranchByProjectId: next }
    }),

  setWorktreeSyncStatus: (projectId, workspaces) =>
    set((s) => {
      const next = new Map(s.worktreeSyncStatus)
      for (const [pathKey, info] of Object.entries(workspaces)) {
        const ws = s.workspaces.find(
          (w) =>
            w.projectId === projectId &&
            (pathsEqualOrAlias(w.worktreePath, info.workspacePath) ||
              pathsEqualOrAlias(w.worktreePath, pathKey)),
        )
        if (ws) next.set(ws.id, info)
      }
      return { worktreeSyncStatus: next }
    }),

  setSpotlightWorkspace: (projectId, workspaceId) =>
    set((s) => {
      const prev = s.spotlightWorkspaceIdByProject[projectId] ?? null
      if (prev === workspaceId) return {}
      const next = { ...s.spotlightWorkspaceIdByProject }
      if (workspaceId) next[projectId] = workspaceId
      else delete next[projectId]
      return { spotlightWorkspaceIdByProject: next }
    }),

  setSpotlightStatus: (status) =>
    set((s) => {
      const next = new Map(s.spotlightStatusByProject)
      if (status.state === 'idle' && !status.workspaceId) {
        next.delete(status.projectId)
      } else {
        next.set(status.projectId, status)
      }
      return { spotlightStatusByProject: next }
    }),

  setGraphiteStack: (workspaceId, stack) =>
    set((s) => {
      const next = new Map(s.graphiteStacks)
      if (stack) {
        next.set(workspaceId, stack)
      } else {
        next.delete(workspaceId)
      }
      return { graphiteStacks: next }
    }),

  toggleGraphiteStackExpanded: () =>
    set((s) => ({ graphiteStackExpanded: !s.graphiteStackExpanded })),

  setContextWindowData: (data) => set({ contextWindowData: data }),

  addAutomation: (automation) =>
    set((s) => ({ automations: [...s.automations, normalizeRendererAutomation(automation)] })),

  updateAutomation: (id, partial) =>
    set((s) => ({
      automations: s.automations.map((a) => (a.id === id ? normalizeRendererAutomation({ ...a, ...partial }) : a)),
    })),

  removeAutomation: (id) =>
    set((s) => ({ automations: s.automations.filter((a) => a.id !== id) })),

  addSkill: (skill) =>
    set((s) => ({ settings: { ...s.settings, skills: [...s.settings.skills, skill] } })),
  removeSkill: (id) =>
    set((s) => ({ settings: { ...s.settings, skills: s.settings.skills.filter((sk) => sk.id !== id) } })),
  updateSkill: (id, partial) =>
    set((s) => ({ settings: { ...s.settings, skills: s.settings.skills.map((sk) => sk.id === id ? { ...sk, ...partial } : sk) } })),
  addSubagent: (subagent) =>
    set((s) => ({ settings: { ...s.settings, subagents: [...s.settings.subagents, subagent] } })),
  removeSubagent: (id) =>
    set((s) => ({ settings: { ...s.settings, subagents: s.settings.subagents.filter((sa) => sa.id !== id) } })),
  updateSubagent: (id, partial) =>
    set((s) => ({ settings: { ...s.settings, subagents: s.settings.subagents.map((sa) => sa.id === id ? { ...sa, ...partial } : sa) } })),

  openDiffTab: (workspaceId) => {
    const s = get()
    const existing = s.tabs.find(
      (t) => t.workspaceId === workspaceId && t.type === 'diff'
    )
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    get().addTab({
      id: crypto.randomUUID(),
      workspaceId,
      type: 'diff',
    })
  },

  openCommitDiffTab: (workspaceId, hash, message) => {
    const s = get()
    // Reuse existing commit-diff tab for this workspace (one with commitHash set)
    const existing = s.tabs.find(
      (t) => t.workspaceId === workspaceId && t.type === 'diff' && t.commitHash
    )
    if (existing) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === existing.id && t.type === 'diff'
            ? { ...t, commitHash: hash, commitMessage: message }
            : t
        ),
        activeTabId: existing.id,
      }))
      return
    }
    get().addTab({
      id: crypto.randomUUID(),
      workspaceId,
      type: 'diff',
      commitHash: hash,
      commitMessage: message,
    })
  },

  setSidePanelsForWorkspace: (workspaceId, layout) => {
    set((s) => ({
      sidePanelsByWorkspace: { ...s.sidePanelsByWorkspace, [workspaceId]: layout },
    }))
  },

  setHunkReviewWidth: (workspaceId, widthPx) => {
    set((s) => {
      const next = { ...s.hunkReviewWidthByWorkspace }
      if (widthPx === undefined || !Number.isFinite(widthPx)) delete next[workspaceId]
      else next[workspaceId] = widthPx
      return { hunkReviewWidthByWorkspace: next }
    })
  },

  setFileTreeExpandedPaths: (workspaceId, paths) => {
    set((s) => {
      const prev = s.fileTreeExpandedPathsByWorkspace[workspaceId] ?? []
      // Avoid no-op writes that would otherwise cause persistence churn
      if (
        prev.length === paths.length &&
        prev.every((p, i) => p === paths[i])
      ) {
        return {}
      }
      return {
        fileTreeExpandedPathsByWorkspace: {
          ...s.fileTreeExpandedPathsByWorkspace,
          [workspaceId]: [...paths],
        },
      }
    })
  },

  setReviewPanelState: (workspaceId, partial) => {
    set((s) => {
      const prev = s.reviewPanelStateByWorkspace[workspaceId] ?? {
        reviewMode: 'annotations' as const,
        activeTourStepId: null,
        activeFile: null,
        visibleCount: 50,
        viewedFilePaths: [],
        selectedIds: [],
      }
      const next = { ...prev, ...partial }
      return {
        reviewPanelStateByWorkspace: {
          ...s.reviewPanelStateByWorkspace,
          [workspaceId]: next,
        },
      }
    })
  },

  setStagedSelection: (workspaceId, paths) => {
    set((s) => ({
      stagedSelectionByWorkspace: {
        ...s.stagedSelectionByWorkspace,
        [workspaceId]: [...paths],
      },
    }))
  },

  setFileTabViewState: (tabId, viewState) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.type === 'file' ? { ...t, viewState } : t,
      ),
    }))
  },

  hydrateState: (data) => {
    const projects = (data.projects ?? []).map((project) => normalizeProject(project))
    const workspaces = data.workspaces ?? []
    const saved = data.activeWorkspaceId
    const settingsMerged = data.settings ? { ...DEFAULT_SETTINGS, ...data.settings } : { ...DEFAULT_SETTINGS }
    for (const k of LEGACY_REMOVED_SETTING_KEYS) {
      delete (settingsMerged as Record<string, unknown>)[k]
    }
    const normalizedPriorityPreset = normalizeLinearIssuesPriorityPreset(
      settingsMerged.linearIssuesPriorityPreset,
    )
    const normalizedIssueFilters = normalizeLinearIssueFilters(
      settingsMerged.linearIssueFilters,
    )
    // Forward-migrate the deprecated priority preset: if a legacy profile had a
    // non-'all' preset and we have no priorities in the new filters object yet,
    // seed the filters and reset the preset to 'all' so this only runs once.
    let migratedPriorityPreset: LinearIssuesPriorityPreset = normalizedPriorityPreset
    let migratedIssueFilters = normalizedIssueFilters
    if (
      normalizedPriorityPreset !== 'all' &&
      normalizedIssueFilters.priorities.length === 0
    ) {
      migratedIssueFilters = {
        ...normalizedIssueFilters,
        priorities: [Number(normalizedPriorityPreset)],
      }
      migratedPriorityPreset = 'all'
    }
    const settings = {
      ...settingsMerged,
      linearWorkspaceView: normalizeLinearWorkspaceView(settingsMerged.linearWorkspaceView),
      linearWorkspaceTabOrder: normalizeLinearWorkspaceTabOrder(
        settingsMerged.linearWorkspaceTabOrder,
      ),
      linearIssueScope: normalizeLinearIssueScope(settingsMerged.linearIssueScope),
      linearIssuesPriorityPreset: migratedPriorityPreset,
      linearIssueFilters: migratedIssueFilters,
      linearIssueDensity: normalizeLinearIssueDensity(settingsMerged.linearIssueDensity),
      linearIssueStateGroupsCollapsed: normalizeLinearIssueStateGroupsCollapsed(
        settingsMerged.linearIssueStateGroupsCollapsed,
      ),
      linearIssueCodingAgent: normalizeLinearIssueCodingAgent(
        settingsMerged.linearIssueCodingAgent,
      ),
      linearIssueCodingModel: normalizeLinearIssueCodingModel(settingsMerged.linearIssueCodingModel),
      conflictResolverAgent: normalizeConflictResolverAgent(settingsMerged.conflictResolverAgent),
      conflictResolverModel: normalizeConflictResolverModel(settingsMerged.conflictResolverModel),
      piCommitMessageModel: normalizePiCommitMessageModel(settingsMerged.piCommitMessageModel),
      worktreeCredentialRules: normalizeWorktreeCredentialRules(settingsMerged.worktreeCredentialRules),
      skills: normalizeSkillEntries(settingsMerged.skills),
      subagents: normalizeSubagentEntries(settingsMerged.subagents),
      editorLanguageOverrides: normalizeEditorLanguageOverrideMap(
        settingsMerged.editorLanguageOverrides,
      ),
    }
    const globalSidePanels = normalizePersistedSidePanelLayout(data)
    // Track 8: prefer the active workspace's persisted layout over the legacy
    // global one so per-workspace remembered layouts survive a restart.
    const sidePanelsMap = normalizeSidePanelsByWorkspace(data.sidePanelsByWorkspace, globalSidePanels, workspaces)
    const activeIdGuess = data.activeWorkspaceId && workspaces.some((w) => w.id === data.activeWorkspaceId)
      ? data.activeWorkspaceId
      : workspaces[0]?.id ?? null
    const sidePanels = (activeIdGuess && sidePanelsMap[activeIdGuess]) || globalSidePanels
    const activeWorkspaceId = settings.restoreWorkspace
      ? ((saved && workspaces.some((w) => w.id === saved) ? saved : workspaces[0]?.id) ?? null)
      : null
    // Tabs will be reconciled with live PTYs asynchronously after set.
    // Normalize split trees from old persisted state (leaves without contentType).
    const rawTabs = data.tabs ?? []
    const tabs = rawTabs.map((tab) => {
      if (tab.type === 'terminal' && tab.splitRoot) {
        return { ...tab, splitRoot: normalizeSplitTree(tab.splitRoot) }
      }
      if (tab.type === 'file' && tab.splitRoot) {
        return { ...tab, splitRoot: normalizeSplitTree(tab.splitRoot) }
      }
      return tab
    })
    const activeTabId = data.activeTabId ?? null
    const seeded = seedFoldersForProjects(projects, workspaces, normalizeFolders(data.folders))
    set({
      projects: seeded.projects,
      workspaces: seeded.workspaces,
      folders: seeded.folders,
      tabs,
      automations: (data.automations ?? []).map((automation) => normalizeRendererAutomation(automation)),
      activeWorkspaceId,
      activeTabId,
      lastActiveTabByWorkspace: data.lastActiveTabByWorkspace ?? {},
      sidePanels,
      collapsedProjectIds: new Set(),
      lastActiveWorkspaceByProjectId: activeWorkspaceId
        ? Object.fromEntries(
            workspaces
              .filter((workspace) => workspace.id === activeWorkspaceId)
              .map((workspace) => [workspace.projectId, workspace.id]),
          )
        : {},
      settings,
      composioWebhook: normalizeComposioWebhook(data.composioWebhook),
      worktreeSyncStatus: new Map(),
      graphiteStacks: new Map(),
      graphiteStackExpanded: false,
      spotlightWorkspaceIdByProject: normalizeSpotlightWorkspaceMap(
        (data as { spotlightWorkspaceIdByProject?: unknown }).spotlightWorkspaceIdByProject,
      ),
      spotlightStatusByProject: new Map(),
      lastKnownRemoteHead: {},
      activeMonacoEditor: null,
      planBuildTerminalByPlanPath: {},
      sidebarActionOrder: normalizeSidebarActionOrder(data.sidebarActionOrder),
      sidePanelsByWorkspace: sidePanelsMap,
      hunkReviewWidthByWorkspace: normalizeHunkReviewWidthByWorkspace(data.hunkReviewWidthByWorkspace, settings.hunkReviewWidthPx),
      fileTreeExpandedPathsByWorkspace: normalizeStringArrayByWorkspace(data.fileTreeExpandedPathsByWorkspace),
      reviewPanelStateByWorkspace: normalizeReviewPanelStateByWorkspace(data.reviewPanelStateByWorkspace),
      stagedSelectionByWorkspace: normalizeStringArrayByWorkspace(data.stagedSelectionByWorkspace),
    })
  },

  activeWorkspaceTabs: () => {
    const s = get()
    return s.tabs.filter((t) => t.workspaceId === s.activeWorkspaceId)
  },

  activeProject: () => {
    const s = get()
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    return ws ? s.projects.find((p) => p.id === ws.projectId) : undefined
  },

  visibleProjects: () => {
    const s = get()
    return getVisibleProjects(s.projects)
  },

  visibleWorkspaces: () => {
    const s = get()
    return getVisibleWorkspaces(s.projects, s.workspaces, s.collapsedProjectIds)
  },

  resolveProjectTargetWorkspace: (projectId) => {
    const s = get()
    return resolveSidebarProjectTargetWorkspace(
      projectId,
      s.workspaces,
      s.lastActiveWorkspaceByProjectId,
    )
  },
}))

/** t3 agent sandboxes live under `~/.t3/worktrees/<repoDir>/…`. */
function isT3WorktreePath(path: string): boolean {
  return path.replace(/\\/g, '/').includes('/.t3/worktrees/')
}

async function resolveListedWorktreeBranch(
  wt: { path: string; branch: string; isDetached?: boolean },
  path: string,
): Promise<string> {
  let branch = (wt.branch || '').trim().replace(/^refs\/heads\//, '')
  if (!branch) {
    try {
      branch = (await window.api.git.getCurrentBranch(path)).trim().replace(/^refs\/heads\//, '')
    } catch {
      branch = ''
    }
  }
  return branch
}

/**
 * Merge git worktrees from `git worktree list` (plus t3's `~/.t3/worktrees/…` scan) into the store
 * when they are missing from persisted state. The sidebar only renders app workspaces.
 *
 * Also repairs persisted rows stuck with branch `HEAD` / empty when git now reports a real branch.
 */
async function runReconcileGitWorktreesForStore(projectIdFilter: string | null): Promise<void> {
  const projects =
    projectIdFilter === null
      ? useAppStore.getState().projects
      : useAppStore.getState().projects.filter((p) => p.id === projectIdFilter)
  if (projects.length === 0) return

  const additions: Workspace[] = []
  const branchPatches = new Map<string, string>()

  for (const project of projects) {
    let listed: { path: string; branch: string; head: string; isBare: boolean; isDetached?: boolean }[]
    try {
      listed = await window.api.git.listWorktrees(project.repoPath)
    } catch {
      continue
    }

    const workspacesSnap = useAppStore.getState().workspaces
    const currentForProject = workspacesSnap.filter((w) => w.projectId === project.id)

    for (const w of currentForProject) {
      const p = w.worktreePath?.trim()
      if (!p) continue
      const wt = listed.find((x) => x.path && pathsEqualOrAlias(x.path, p))
      if (!wt || wt.isBare) continue
      const t3 = isT3WorktreePath(p)
      if (wt.isDetached && !t3) continue
      const resolved = await resolveListedWorktreeBranch(wt, p)
      if (t3 && isDetachedHeadBranchLabel(resolved)) continue
      if (!t3 && isDetachedHeadBranchLabel(resolved)) continue
      if (!resolved) continue
      const prev = (w.branch || '').trim()
      if (isDetachedHeadBranchLabel(prev) || prev === '' || prev.toUpperCase() === 'HEAD') {
        if (resolved !== prev) branchPatches.set(w.id, resolved)
      }
    }

    for (const wt of listed) {
      if (wt.isBare) continue
      const path = wt.path?.trim()
      if (!path) continue
      const t3 = isT3WorktreePath(path)
      if (wt.isDetached && !t3) continue
      if (currentForProject.some((w) => pathsEqualOrAlias(w.worktreePath, path))) continue
      if (additions.some((w) => w.projectId === project.id && pathsEqualOrAlias(w.worktreePath, path))) continue

      let branch = await resolveListedWorktreeBranch(wt, path)
      if (t3 && isDetachedHeadBranchLabel(branch)) {
        branch = ''
      }
      if (!t3 && isDetachedHeadBranchLabel(branch)) continue

      const fallbackName = path.split(/[/\\]/).filter(Boolean).pop() || 'workspace'
      const name = branch || fallbackName

      additions.push({
        id: crypto.randomUUID(),
        name,
        branch,
        worktreePath: path,
        projectId: project.id,
      })
    }
  }

  if (additions.length === 0 && branchPatches.size === 0) return

  if (additions.length > 0) {
    console.info(`[constellagent] merged ${additions.length} git worktree(s) into sidebar state`)
  }
  if (branchPatches.size > 0) {
    console.info(`[constellagent] repaired branch label(s) on ${branchPatches.size} workspace(s) from git worktree list`)
  }

  useAppStore.setState((s) => {
    let nextWorkspaces = s.workspaces.map((w) => {
      const newBranch = branchPatches.get(w.id)
      if (!newBranch) return w
      const next = { ...w, branch: newBranch }
      if (
        w.name === w.branch
        || /^ws-[a-z0-9]+$/i.test(w.name)
        || !w.name.trim()
      ) {
        next.name = newBranch
      }
      return next
    })
    nextWorkspaces = [...nextWorkspaces, ...additions]
    let activeWorkspaceId = s.activeWorkspaceId
    if (activeWorkspaceId === null && additions.length > 0) {
      activeWorkspaceId = additions[0].id
    }
    const lastActiveWorkspaceByProjectId = pruneLastActiveWorkspaceByProjectId(
      activeWorkspaceId && additions.some((workspace) => workspace.id === activeWorkspaceId)
        ? {
            ...s.lastActiveWorkspaceByProjectId,
            [additions.find((workspace) => workspace.id === activeWorkspaceId)!.projectId]: activeWorkspaceId,
          }
        : s.lastActiveWorkspaceByProjectId,
      s.projects,
      nextWorkspaces,
    )
    return { workspaces: nextWorkspaces, activeWorkspaceId, lastActiveWorkspaceByProjectId }
  })
}

let reconcileGitWorktreesInFlight: Promise<void> | null = null
let queuedReconcileProjectIdFilter: string | null | undefined

function mergeReconcileProjectFilter(
  current: string | null | undefined,
  incoming: string | null,
): string | null {
  if (current === undefined) return incoming
  if (current === null || incoming === null) return null
  return current === incoming ? current : null
}

async function reconcileGitWorktreesForStore(projectIdFilter: string | null): Promise<void> {
  queuedReconcileProjectIdFilter = mergeReconcileProjectFilter(
    queuedReconcileProjectIdFilter,
    projectIdFilter,
  )
  if (reconcileGitWorktreesInFlight) {
    return reconcileGitWorktreesInFlight
  }

  reconcileGitWorktreesInFlight = (async () => {
    while (queuedReconcileProjectIdFilter !== undefined) {
      const nextFilter = queuedReconcileProjectIdFilter
      queuedReconcileProjectIdFilter = undefined
      await runReconcileGitWorktreesForStore(nextFilter)
    }
  })().finally(() => {
    reconcileGitWorktreesInFlight = null
  })

  return reconcileGitWorktreesInFlight
}

// ── State persistence ──

function getPersistedSlice(state: AppState): PersistedState {
  return {
    projects: state.projects.map(({ startupCommands, ...project }) => project),
    workspaces: state.workspaces,
    folders: state.folders,
    tabs: state.tabs,
    automations: state.automations,
    composioWebhook: state.composioWebhook,
    activeWorkspaceId: state.activeWorkspaceId,
    activeTabId: state.activeTabId,
    lastActiveTabByWorkspace: state.lastActiveTabByWorkspace,
    settings: state.settings,
    sidePanels: state.sidePanels,
    sidePanelsByWorkspace: state.sidePanelsByWorkspace,
    hunkReviewWidthByWorkspace: state.hunkReviewWidthByWorkspace,
    fileTreeExpandedPathsByWorkspace: state.fileTreeExpandedPathsByWorkspace,
    reviewPanelStateByWorkspace: state.reviewPanelStateByWorkspace,
    stagedSelectionByWorkspace: state.stagedSelectionByWorkspace,
    sidebarActionOrder: state.sidebarActionOrder,
    spotlightWorkspaceIdByProject: state.spotlightWorkspaceIdByProject,
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function debouncedSave(state: AppState) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    window.api.state.save(getPersistedSlice(state))
  }, 500)
}

// Subscribe to store changes and debounce-save persisted slice
useAppStore.subscribe((state, prevState) => {
  if (
    state.projects !== prevState.projects ||
    state.workspaces !== prevState.workspaces ||
    state.folders !== prevState.folders ||
    state.tabs !== prevState.tabs ||
    state.activeTabId !== prevState.activeTabId ||
    state.automations !== prevState.automations ||
    state.composioWebhook !== prevState.composioWebhook ||
    state.activeWorkspaceId !== prevState.activeWorkspaceId ||
    state.settings !== prevState.settings ||
    state.sidePanels !== prevState.sidePanels ||
    state.sidePanelsByWorkspace !== prevState.sidePanelsByWorkspace ||
    state.hunkReviewWidthByWorkspace !== prevState.hunkReviewWidthByWorkspace ||
    state.fileTreeExpandedPathsByWorkspace !== prevState.fileTreeExpandedPathsByWorkspace ||
    state.reviewPanelStateByWorkspace !== prevState.reviewPanelStateByWorkspace ||
    state.stagedSelectionByWorkspace !== prevState.stagedSelectionByWorkspace ||
    state.sidebarActionOrder !== prevState.sidebarActionOrder ||
    state.spotlightWorkspaceIdByProject !== prevState.spotlightWorkspaceIdByProject
  ) {
    debouncedSave(state)
  }
})

// Track 8: mirror in-workspace sidePanels mutations into the per-workspace
// map so the layout sticks to the workspace, not the app. Skipping the
// activeWorkspace check here would clobber the map with the global default
// before any workspace is active.
useAppStore.subscribe((state, prevState) => {
  if (state.sidePanels === prevState.sidePanels) return
  if (state.activeWorkspaceId !== prevState.activeWorkspaceId) return
  const wsId = state.activeWorkspaceId
  if (!wsId) return
  if (state.sidePanelsByWorkspace[wsId] === state.sidePanels) return
  useAppStore.setState({
    sidePanelsByWorkspace: {
      ...state.sidePanelsByWorkspace,
      [wsId]: state.sidePanels,
    },
  })
})

useAppStore.subscribe((state, prevState) => {
  if (activeAgentSetsEqual(state.activeClaudeWorkspaceIds, prevState.activeClaudeWorkspaceIds)) return
  const paths = [...state.activeClaudeWorkspaceIds]
    .map((wsId) => state.workspaces.find((w) => w.id === wsId)?.worktreePath)
    .filter((p): p is string => Boolean(p))
  window.api.git.setSyncBusy(paths)
})

// Flush state to disk synchronously when the window is closing.
// Uses sendSync + writeFileSync so the write completes before the renderer is destroyed.
window.addEventListener('beforeunload', () => {
  if (saveTimer) clearTimeout(saveTimer)
  window.api.state.saveSync(getPersistedSlice(useAppStore.getState()))
})

// Load persisted state on startup
export async function hydrateFromDisk(): Promise<void> {
  try {
    const data = await window.api.state.load()
    if (data) {
      useAppStore.getState().hydrateState(data)
      const { conductorCursorApiKey, conductorOpenaiApiKey } = useAppStore.getState().settings
      void syncConductorAuthKeys(conductorCursorApiKey, conductorOpenaiApiKey)
      await normalizeProjectRepoAnchorsInStore()
      await syncExternalProjectStartupSettingsForProjects(useAppStore.getState().projects)
    }
  } catch (err) {
    console.error('Failed to load persisted state:', err)
  }

  await reconcileGitWorktreesForStore(null)

  // Reconcile persisted terminal tabs against live PTY processes
  try {
    const livePtyIds = new Set(await window.api.pty.list())
    const store = useAppStore.getState()
    const tabs = store.tabs

    if (tabs.length > 0 && livePtyIds.size > 0) {
      // Reattach surviving terminal tabs to the new webContents
      const reattachPromises: Promise<boolean>[] = []
      for (const tab of tabs) {
        if (tab.type === 'terminal') {
          // Reattach primary PTY
          if (livePtyIds.has(tab.ptyId)) {
            reattachPromises.push(window.api.pty.reattach(tab.ptyId))
          }
          // Reattach split pane PTYs
          if (tab.splitRoot) {
            for (const splitPtyId of getAllPtyIds(tab.splitRoot)) {
              if (splitPtyId !== tab.ptyId && livePtyIds.has(splitPtyId)) {
                reattachPromises.push(window.api.pty.reattach(splitPtyId))
              }
            }
          }
        }
      }
      await Promise.all(reattachPromises)
    }

    // Respawn PTYs for terminal tabs whose primary process is no longer alive.
    // For simplicity, split panes are collapsed on restart — only the primary PTY is respawned.
    const deadTabs = tabs.filter(
      (t): t is Extract<Tab, { type: 'terminal' }> =>
        t.type === 'terminal' && !livePtyIds.has(t.ptyId)
    )
    if (deadTabs.length > 0) {
      const shell = store.settings.defaultShell || undefined
      const updatedTabs = [...tabs]
      for (const dead of deadTabs) {
        const ws = store.workspaces.find((w) => w.id === dead.workspaceId)
        if (!ws) continue
        try {
          const newPtyId = await window.api.pty.create(ws.worktreePath, shell, { AGENT_ORCH_WS_ID: ws.id })
          const idx = updatedTabs.findIndex((t) => t.id === dead.id)
          // Collapse splits on respawn — start fresh with a single terminal
          if (idx !== -1) updatedTabs[idx] = { ...dead, ptyId: newPtyId, splitRoot: undefined, focusedPaneId: undefined }
        } catch {
          // If respawn fails, drop the tab
          const idx = updatedTabs.findIndex((t) => t.id === dead.id)
          if (idx !== -1) updatedTabs.splice(idx, 1)
        }
      }
      // Drop any terminal tabs whose workspace no longer exists
      const finalTabs = updatedTabs.filter(
        (t) => t.type !== 'terminal' || store.workspaces.some((w) => w.id === t.workspaceId)
      )
      const activeTabId = finalTabs.find((t) => t.id === store.activeTabId)
        ? store.activeTabId
        : (finalTabs.find((t) => t.workspaceId === store.activeWorkspaceId)?.id ?? null)
      useAppStore.setState({ tabs: finalTabs, activeTabId })
    }
  } catch (err) {
    console.error('Failed to reconcile PTY tabs:', err)
  }

  const state = useAppStore.getState()
  for (const project of state.projects) {
    void window.api.git.startSyncPolling(project.id, project.repoPath)
  }
  {
    const paths = [...state.activeClaudeWorkspaceIds]
      .map((wsId) => state.workspaces.find((w) => w.id === wsId)?.worktreePath)
      .filter((p): p is string => Boolean(p))
    window.api.git.setSyncBusy(paths)
  }

  // Schedule all enabled automations on startup
  for (const automation of state.automations) {
    if (!automation.enabled) continue
    const project = state.projects.find((p) => p.id === automation.projectId)
    if (!project) continue
    window.api.automations.create(toAutomationIpcConfig(automation, project.repoPath))
  }

  // Listen for automation run-started events from main process
  window.api.automations.onRunStarted((data) => {
    const store = useAppStore.getState()
    const { automationId, automationName, projectId, repoPath: repoPathHint, ptyId, worktreePath, branch, agentType } = data
    const project = resolveProjectForAutomationRun(store.projects, projectId, repoPathHint)
    if (!project) {
      store.addToast({
        id: crypto.randomUUID(),
        type: 'error',
        message: `Could not attach automation “${automationName}” to a project. Open that repository in Constellagent first.`,
      })
      return
    }

    // Same as Linear agent flow: exit overlay panels so the new workspace + terminal are visible.
    useAppStore.setState({
      automationsOpen: false,
      settingsOpen: false,
      linearPanelOpen: false,
      linearQuickOpenVisible: false,
    })

    const wsId = crypto.randomUUID()
    const wsTitle = automationName.slice(0, 120)
    store.addWorkspace({
      id: wsId,
      name: wsTitle,
      branch: branch || '',
      worktreePath: worktreePath || project.repoPath,
      projectId: project.id,
      automationId,
    })

    const terminalTitle = `${automationName.slice(0, 80)} · agent`
    store.addTab({
      id: crypto.randomUUID(),
      workspaceId: wsId,
      type: 'terminal',
      title: terminalTitle,
      ptyId,
      ...(agentType ? { agentType } : {}),
    })

    store.addToast({
      id: crypto.randomUUID(),
      type: 'info',
      message: `Agent running in new workspace for ${automationName.slice(0, 72)}${automationName.length > 72 ? '…' : ''}`,
    })

    store.updateAutomation(automationId, { lastRunAt: Date.now(), lastRunStatus: 'success' })
  })

  window.api.automations.onStatusUpdated((data) => {
    useAppStore.getState().updateAutomation(data.automationId, {
      lastRunAt: data.timestamp,
      lastRunStatus: data.status,
    })
  })
}
