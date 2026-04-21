import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/app-store'

const POLL_INTERVAL = 60_000

export function useWorktreeSyncPoller(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runningRef = useRef(false)

  useEffect(() => {
    let disposed = false

    async function poll() {
      if (disposed || document.hidden || runningRef.current) return
      runningRef.current = true

      try {
        const { projects, workspaces, activeWorkspaceId, lastKnownRemoteHead, setLastKnownRemoteHead } =
          useAppStore.getState()
        const activeProjectId = activeWorkspaceId
          ? workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.projectId ?? null
          : null

        for (const project of projects) {
          if (disposed) break
          const projectWs = workspaces.filter((w) => w.projectId === project.id)
          if (projectWs.length === 0) continue

          try {
            const hash = await window.api.git.getRemoteHead(project.repoPath)
            if (!hash) continue

            const prev = lastKnownRemoteHead[project.id]
            if (hash !== prev) {
              if (!prev) {
                setLastKnownRemoteHead(project.id, hash)
                continue
              }
              if (project.id === activeProjectId) {
                continue
              }
              await window.api.git.syncAllWorktrees(project.id)
              setLastKnownRemoteHead(project.id, hash)
            }
          } catch {
            // Network issue or missing remote — skip
          }
        }
      } finally {
        runningRef.current = false
      }

      if (!disposed && !document.hidden) {
        timerRef.current = setTimeout(poll, POLL_INTERVAL)
      }
    }

    const onVisibility = () => {
      if (document.hidden) {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
      } else {
        poll()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    // Initial poll after a short delay
    timerRef.current = setTimeout(poll, 5_000)

    return () => {
      disposed = true
      if (timerRef.current) clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
}
