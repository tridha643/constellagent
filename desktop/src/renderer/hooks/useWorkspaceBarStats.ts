import { useEffect } from 'react'
import { useAppStore } from '../store/app-store'

// Live edits arrive in bursts (a turn can touch dozens of files); collapse them
// into a single recompute so the bar updates ~instantly without thrashing git.
const EDIT_DEBOUNCE_MS = 150
// Safety net only — every reactive trigger below normally keeps stats fresh.
// This catches drift the FS watcher can miss (e.g. `.git/`-only mutations on the
// active row) without the old 90s whole-fleet poll.
const ACTIVE_SAFETY_POLL_INTERVAL = 5 * 60_000

/**
 * Read working-tree-inclusive bar stats (`commit subject` + `+N -N`) for one
 * workspace and write them into the store. The store setter dirty-checks, so
 * redundant calls are cheap. Mirrors the Changes-panel scope: the git backend
 * (`GitService.getWorkspaceBarStats`) is the source of truth.
 */
async function recomputeWorkspaceBarStats(workspaceId: string): Promise<void> {
  const {
    workspaces,
    defaultBranchByProjectId,
    workspaceBarStatsMap,
    setWorkspaceBarStats,
  } = useAppStore.getState()
  const ws = workspaces.find((workspace) => workspace.id === workspaceId)
  if (!ws?.worktreePath) return
  try {
    const stats = await window.api.git.getWorkspaceBarStats(
      ws.worktreePath,
      defaultBranchByProjectId.get(ws.projectId),
    )
    // Don't seed an empty row for a workspace we've never resolved (e.g. a repo
    // with no commits yet); but always dispatch once we have a baseline so live
    // working-tree edits propagate. The setter short-circuits identical values.
    if (!stats.headSha && !workspaceBarStatsMap.has(ws.id)) return
    setWorkspaceBarStats(ws.id, stats)
  } catch {
    // Stats are nice-to-have — silently ignore (non-git path, transient error).
  }
}

/**
 * Keeps local-mode workspace bar stats fresh **reactively** instead of polling.
 * Recompute triggers, in order of how the rudu bar drifts in practice:
 *   1. Workspace set changes (created/removed/path-changed) → compute every row.
 *   2. Workspace switch → recompute the newly-active row immediately.
 *   3. A turn finishes (`onNotifyWorkspace`) → recompute that row.
 *   4. Live edits on the active row (`git:files-changed` + FS watcher), debounced.
 *   5. A slow safety poll for the active row only.
 * Also lazily resolves each project's GitHub `owner/repo` for the header avatar
 * (previously folded into the poll loop — preserved here as a one-shot effect).
 */
export function useWorkspaceBarStats(): void {
  // Re-keys whenever a workspace is added/removed or its worktree path changes.
  const workspaceKey = useAppStore((s) =>
    s.workspaces
      .map((ws) => `${ws.id}:${ws.worktreePath}`)
      .sort()
      .join('|'),
  )
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const projectKey = useAppStore((s) => s.projects.map((p) => p.id).join('|'))

  // Trigger 1: compute once for every current workspace (fixes `+0 -0` and any
  // newly-created row that hasn't been resolved yet).
  useEffect(() => {
    for (const ws of useAppStore.getState().workspaces) {
      void recomputeWorkspaceBarStats(ws.id)
    }
  }, [workspaceKey])

  // Trigger 2: workspace switch — refresh the active row right away.
  useEffect(() => {
    if (activeWorkspaceId) void recomputeWorkspaceBarStats(activeWorkspaceId)
  }, [activeWorkspaceId])

  // Trigger 3: a turn finished (notify hook / PTY exit) → recompute that row.
  useEffect(() => {
    const unsub = window.api.claude.onNotifyWorkspace((wsId: string) => {
      void recomputeWorkspaceBarStats(wsId)
    })
    return unsub
  }, [])

  // Trigger 4 + 5: live edits + safety poll, scoped to the active workspace.
  useEffect(() => {
    if (!activeWorkspaceId) return
    const ws = useAppStore
      .getState()
      .workspaces.find((workspace) => workspace.id === activeWorkspaceId)
    const worktreePath = ws?.worktreePath
    if (!worktreePath) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRecompute = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        void recomputeWorkspaceBarStats(activeWorkspaceId)
      }, EDIT_DEBOUNCE_MS)
    }

    // FS watcher (ref-counted in main, so this composes with the Changes panel).
    window.api.fs.watchDir(worktreePath)
    const unsubDir = window.api.fs.onDirChanged((changedDir: string) => {
      if (changedDir === worktreePath) scheduleRecompute()
    })

    // Explicit git mutations broadcast this CustomEvent (commit, stage, restore).
    const onGitFilesChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ worktreePath?: string }>).detail
      if (detail?.worktreePath === worktreePath) scheduleRecompute()
    }
    window.addEventListener('git:files-changed', onGitFilesChanged)

    const pollTimer = setInterval(() => {
      void recomputeWorkspaceBarStats(activeWorkspaceId)
    }, ACTIVE_SAFETY_POLL_INTERVAL)

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      window.removeEventListener('git:files-changed', onGitFilesChanged)
      unsubDir()
      window.api.fs.unwatchDir(worktreePath)
      clearInterval(pollTimer)
    }
  }, [activeWorkspaceId])

  // Lazily resolve owner/repo for any project we haven't looked up yet (header
  // avatar). One-shot per project; non-GitHub / offline leaves it unresolved.
  useEffect(() => {
    const { projects, repoInfoByProjectId, setProjectRepoInfo } = useAppStore.getState()
    for (const project of projects) {
      if (repoInfoByProjectId.has(project.id)) continue
      window.api.github
        .getRepoInfo(project.repoPath)
        .then((info) => setProjectRepoInfo(project.id, info))
        .catch(() => {
          // Non-GitHub / offline — leave unresolved; render falls back to name.
        })
    }
  }, [projectKey])
}
