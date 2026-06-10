import type { CustomSection, Project, Workspace } from './types'
import type { PrInfo } from '@shared/github-types'
import type { WorkspaceSyncInfo } from '@shared/worktree-sync-types'
import type { SpotlightStatus } from '@shared/spotlight-types'
import type { WorkspaceBarStats } from '@shared/git-types'

export function getVisibleProjects(projects: Project[]): Project[] {
  return projects
}

export function getRenderableProjectWorkspaces(workspaces: Workspace[], projectId: string): Workspace[] {
  return workspaces.filter((workspace) => workspace.projectId === projectId)
}

/** Auto-derived sidebar status buckets, in their fixed render order (Pinned is separate). */
export type WorkspaceBucket = 'needs-you' | 'in-review' | 'active' | 'idle'

/** A rendered sidebar section id: the pinned override, an auto bucket, or a custom section's id. */
export type SectionId = 'pinned' | WorkspaceBucket | (string & {})

/** How a rendered section is governed — drives drop targets + affordances in the sidebar. */
export type SectionKind = 'pinned' | 'auto' | 'custom'

export interface WorkspaceSection {
  id: SectionId
  kind: SectionKind
  label: string
  workspaces: Workspace[]
  /** True for the seeded catch-all (Non-priority) folder — not deletable in the UI. */
  isDefault?: boolean
}

/**
 * Resolved per-workspace signal struct (not the raw store maps). `deriveBucket`
 * reads only this so it stays pure + unit-testable.
 */
export interface WorkspaceSignals {
  /** PR status for this workspace's branch (`prStatusMap`), if any. */
  pr?: PrInfo | null
  /** Worktree sync status (`worktreeSyncStatus`). */
  sync?: WorkspaceSyncInfo
  /** Live spotlight status, only when this workspace is the project's spotlight workspace. */
  spotlight?: SpotlightStatus
  /** Agent actively running in this workspace (`activeClaudeWorkspaceIds`). */
  agentActive?: boolean
  /** Unread output the user hasn't seen — the "agent waiting on you" proxy (`unreadWorkspaceIds`). */
  unread?: boolean
  /** Local working-tree additions/deletions (`workspaceBarStatsMap`). */
  barStats?: WorkspaceBarStats
  /** Last selection/activity ms (`Workspace.lastActiveAt`). */
  lastActiveAt?: number
}

export const WORKSPACE_SECTION_LABELS: Record<SectionId, string> = {
  pinned: 'Pinned',
  'needs-you': 'Needs you',
  'in-review': 'In review',
  active: 'Active',
  idle: 'Idle',
}

/** Fixed render order of the auto sections (Pinned renders first, ahead of these). */
export const WORKSPACE_BUCKET_ORDER: WorkspaceBucket[] = ['needs-you', 'in-review', 'active', 'idle']

const RECENT_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000

function isNeedsYou(signals: WorkspaceSignals): boolean {
  const pr = signals.pr
  if (pr && (pr.isBlockedByCi || pr.isChangesRequested || pr.checkStatus === 'failing')) return true
  if (signals.sync && (signals.sync.status === 'conflict' || signals.sync.status === 'error')) return true
  if (signals.spotlight && (signals.spotlight.state === 'blocked' || signals.spotlight.state === 'error')) return true
  // Unread = agent finished / is waiting on input. Active-running agents are "Active", not "Needs you".
  if (signals.unread) return true
  return false
}

function isActive(signals: WorkspaceSignals, now: number): boolean {
  // A merged PR is done work — it belongs in Idle even if recently touched.
  if (signals.pr?.state === 'merged') return false
  if (signals.agentActive) return true
  const spotlightState = signals.spotlight?.state
  if (
    spotlightState === 'watching' ||
    spotlightState === 'preparing' ||
    spotlightState === 'syncing' ||
    spotlightState === 'restoring'
  ) {
    return true
  }
  if (signals.barStats && ((signals.barStats.additions ?? 0) > 0 || (signals.barStats.deletions ?? 0) > 0)) return true
  if (typeof signals.lastActiveAt === 'number' && now - signals.lastActiveAt < RECENT_ACTIVITY_WINDOW_MS) return true
  return false
}

/**
 * Map a workspace's resolved signals to one auto bucket. Priority-ordered:
 * Needs-you wins (a failing-CI worktree lands here even with an open PR), then
 * In-review (open PR), then Active, then Idle as the catch-all.
 */
export function deriveBucket(signals: WorkspaceSignals, now: number): WorkspaceBucket {
  if (isNeedsYou(signals)) return 'needs-you'
  if (signals.pr?.state === 'open') return 'in-review'
  if (isActive(signals, now)) return 'active'
  return 'idle'
}

/**
 * Split a project's workspaces into its folder sections. Every workspace lives in
 * a folder: an explicit `sectionId` if it still exists, otherwise the default
 * (Non-priority) catch-all. Folders render in `order`, always emitted — even when
 * empty — so each stays a valid drop target. There are no auto status buckets or
 * a Pinned section anymore; placement is purely the user's folders.
 *
 * Within a folder, workspaces keep their array order (insertion order, mutated by
 * the `reorderWorkspace` drag action). They are deliberately NOT sorted by
 * `lastActiveAt` — selecting a workspace must not make it jump to the top.
 *
 * `resolveSignals`/`now` are unused now (folders aren't status-derived) but kept
 * in the signature for call-site + test compatibility. `deriveBucket` is retained
 * (and exported) for any status-badge callers.
 */
export function getWorkspaceSections(
  workspaces: Workspace[],
  _resolveSignals: (workspace: Workspace) => WorkspaceSignals,
  _now: number,
  customSections: CustomSection[] = [],
): WorkspaceSection[] {
  const orderedCustom = customSections.slice().sort((a, b) => a.order - b.order)
  const validSectionIds = new Set(orderedCustom.map((sec) => sec.id))
  // The catch-all folder absorbs every workspace without an explicit assignment:
  // the flagged default, else the last folder.
  const defaultSection =
    orderedCustom.find((sec) => sec.isDefault) ??
    orderedCustom[orderedCustom.length - 1]

  const members = new Map<string, Workspace[]>(
    orderedCustom.map((sec) => [sec.id, []]),
  )
  const ungrouped: Workspace[] = []

  for (const ws of workspaces) {
    if (ws.sectionId && validSectionIds.has(ws.sectionId)) {
      members.get(ws.sectionId)!.push(ws)
    } else if (defaultSection) {
      members.get(defaultSection.id)!.push(ws)
    } else {
      ungrouped.push(ws)
    }
  }

  const sections: WorkspaceSection[] = orderedCustom.map((sec) => ({
    id: sec.id,
    kind: 'custom',
    label: sec.name,
    workspaces: members.get(sec.id)!,
    isDefault: sec.isDefault,
  }))

  // Safety net: a project not yet seeded still shows its workspaces.
  if (!defaultSection && ungrouped.length > 0) {
    sections.push({
      id: '__ungrouped',
      kind: 'custom',
      label: 'Non-priority',
      workspaces: ungrouped,
      isDefault: true,
    })
  }
  return sections
}

/** Build the two seeded folders for a project: Priority + the default Non-priority catch-all. */
export function buildDefaultCustomSections(projectId: string): CustomSection[] {
  return [
    { id: crypto.randomUUID(), projectId, name: 'Priority', order: 0 },
    { id: crypto.randomUUID(), projectId, name: 'Non-priority', order: 1, isDefault: true },
  ]
}

/** Append the seeded folders for any project that currently has none. Idempotent. */
export function ensureDefaultCustomSections(
  projects: { id: string }[],
  sections: CustomSection[],
): CustomSection[] {
  const have = new Set(sections.map((s) => s.projectId))
  const additions: CustomSection[] = []
  for (const p of projects) {
    if (!have.has(p.id)) additions.push(...buildDefaultCustomSections(p.id))
  }
  return additions.length ? [...sections, ...additions] : sections
}

export function getVisibleWorkspaces(
  projects: Project[],
  workspaces: Workspace[],
  collapsedProjectIds: Set<string>,
): Workspace[] {
  return getVisibleProjects(projects).flatMap((project) => (
    collapsedProjectIds.has(project.id)
      ? []
      : getRenderableProjectWorkspaces(workspaces, project.id)
  ))
}

/**
 * Workspaces in the exact order they render in the sidebar: every non-collapsed
 * project (in project order), and within each project its folders in `order`
 * with the workspaces inside each folder in array order — exactly what
 * {@link getWorkspaceSections} produces. This is the traversal Cmd+Option+Up/Down
 * follows so the cycle walks straight down the sidebar and across into the next
 * project, irrespective of folder boundaries.
 *
 * Collapsed projects and collapsed folders are skipped: their workspaces aren't
 * visible, so the cycle steps over them exactly as the eye does.
 * `collapsedSidebarSections` is keyed `${projectId}:${sectionId}` (true = collapsed).
 */
export function getOrderedVisibleWorkspaces(
  projects: Project[],
  workspaces: Workspace[],
  collapsedProjectIds: Set<string>,
  customSections: CustomSection[] = [],
  collapsedSidebarSections: Record<string, boolean> = {},
): Workspace[] {
  return getVisibleProjects(projects).flatMap((project) => (
    collapsedProjectIds.has(project.id)
      ? []
      : getWorkspaceSections(
          getRenderableProjectWorkspaces(workspaces, project.id),
          () => ({}),
          0,
          customSections.filter((sec) => sec.projectId === project.id),
        )
          .filter((section) => !collapsedSidebarSections[`${project.id}:${section.id}`])
          .flatMap((section) => section.workspaces)
  ))
}

export function resolveProjectTargetWorkspace(
  projectId: string,
  workspaces: Workspace[],
  lastActiveWorkspaceByProjectId: Record<string, string>,
): Workspace | undefined {
  const candidates = getRenderableProjectWorkspaces(workspaces, projectId)
  if (candidates.length === 0) return undefined

  const preferredId = lastActiveWorkspaceByProjectId[projectId]
  if (preferredId) {
    const preferred = candidates.find((workspace) => workspace.id === preferredId)
    if (preferred) return preferred
  }

  return candidates[0]
}

export function getSwitchableVisibleProjects(
  projects: Project[],
  workspaces: Workspace[],
  lastActiveWorkspaceByProjectId: Record<string, string>,
): Project[] {
  return getVisibleProjects(projects).filter((project) => (
    !!resolveProjectTargetWorkspace(project.id, workspaces, lastActiveWorkspaceByProjectId)
  ))
}
