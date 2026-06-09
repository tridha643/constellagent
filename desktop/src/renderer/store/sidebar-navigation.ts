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

function compareByActivityThenName(a: Workspace, b: Workspace): number {
  const delta = (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)
  if (delta !== 0) return delta
  return a.name.localeCompare(b.name)
}

/**
 * Split a project's workspaces into ordered sections: the hand-ordered Pinned
 * override first, then user-created manual sections (in their `order`), then the
 * auto status buckets. Placement precedence per workspace: custom `sectionId` →
 * `pinned` → `bucketOverride` (force into a bucket) → derived status. Every
 * section is always emitted — even when empty — so any of them can be used as a
 * drop target to override a workspace's placement.
 */
export function getWorkspaceSections(
  workspaces: Workspace[],
  resolveSignals: (workspace: Workspace) => WorkspaceSignals,
  now: number,
  customSections: CustomSection[] = [],
): WorkspaceSection[] {
  const orderedCustom = customSections.slice().sort((a, b) => a.order - b.order)
  const validSectionIds = new Set(orderedCustom.map((sec) => sec.id))
  const customMembers = new Map<string, Workspace[]>(orderedCustom.map((sec) => [sec.id, []]))

  const pinned: Workspace[] = []
  const buckets: Record<WorkspaceBucket, Workspace[]> = {
    'needs-you': [],
    'in-review': [],
    active: [],
    idle: [],
  }

  for (const ws of workspaces) {
    if (ws.sectionId && validSectionIds.has(ws.sectionId)) {
      customMembers.get(ws.sectionId)!.push(ws)
      continue
    }
    if (ws.pinned) {
      pinned.push(ws)
      continue
    }
    const bucket = ws.bucketOverride ?? deriveBucket(resolveSignals(ws), now)
    buckets[bucket].push(ws)
  }

  pinned.sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0))
  for (const members of customMembers.values()) members.sort(compareByActivityThenName)
  for (const bucket of WORKSPACE_BUCKET_ORDER) buckets[bucket].sort(compareByActivityThenName)

  const sections: WorkspaceSection[] = [
    { id: 'pinned', kind: 'pinned', label: WORKSPACE_SECTION_LABELS.pinned, workspaces: pinned },
  ]
  for (const sec of orderedCustom) {
    sections.push({ id: sec.id, kind: 'custom', label: sec.name, workspaces: customMembers.get(sec.id)! })
  }
  for (const bucket of WORKSPACE_BUCKET_ORDER) {
    sections.push({ id: bucket, kind: 'auto', label: WORKSPACE_SECTION_LABELS[bucket], workspaces: buckets[bucket] })
  }
  return sections
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
