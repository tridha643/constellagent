import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/app-store'

const POLL_INTERVAL = 10_000
const BACKGROUND_WORKSPACE_BATCH = 2

function buildPolledWorkspaceList<T extends { id: string; projectId: string }>(
  workspaces: T[],
  activeWorkspaceId: string | null,
  backgroundCursor: number,
): T[] {
  if (workspaces.length === 0) return []
  const activeWorkspace = activeWorkspaceId
    ? workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
    : null
  const activeProjectId = activeWorkspace?.projectId ?? null

  const prioritized = workspaces.filter((workspace) => workspace.projectId === activeProjectId)
  const background = workspaces.filter((workspace) => workspace.projectId !== activeProjectId)
  if (background.length === 0) return prioritized

  const batchSize = Math.min(BACKGROUND_WORKSPACE_BATCH, background.length)
  const batch = Array.from({ length: batchSize }, (_unused, index) => {
    const offset = (backgroundCursor + index) % background.length
    return background[offset]
  }).filter((workspace): workspace is T => workspace !== undefined)

  return [...prioritized, ...batch]
}

export function useGraphiteStackPoller(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runningRef = useRef(false)
  const backgroundCursorRef = useRef(0)

  useEffect(() => {
    let disposed = false

    async function poll() {
      if (disposed || runningRef.current) return
      runningRef.current = true

      try {
        const { projects, workspaces, activeWorkspaceId, setGraphiteStack, updateWorkspaceBranch } =
          useAppStore.getState()
        const backgroundCursor = backgroundCursorRef.current
        const polledWorkspaces = buildPolledWorkspaceList(
          workspaces,
          activeWorkspaceId,
          backgroundCursor,
        )
        backgroundCursorRef.current += BACKGROUND_WORKSPACE_BATCH

        await Promise.allSettled(
          polledWorkspaces.map(async (ws) => {
            const project = projects.find((p) => p.id === ws.projectId)
            if (!project) return

            try {
              const stack = await window.api.graphite.getStack(
                project.repoPath,
                ws.worktreePath,
              )
              setGraphiteStack(ws.id, stack)

              if (stack && stack.currentBranch !== ws.branch) {
                updateWorkspaceBranch(ws.id, stack.currentBranch)
              }
            } catch {
              // Graphite info is nice-to-have — silently ignore
            }
          }),
        )
      } finally {
        runningRef.current = false
      }

      if (!disposed && !document.hidden) {
        timerRef.current = setTimeout(poll, POLL_INTERVAL)
      }
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
      } else {
        void poll()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    void poll()

    return () => {
      disposed = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])
}
