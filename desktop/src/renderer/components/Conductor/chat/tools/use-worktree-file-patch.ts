import { useEffect, useState } from 'react'
import { useAppStore } from '../../../../store/app-store'

/** Load a unified patch from git when the transcript row has paths but no reconstructed diff yet. */
export function useWorktreeFilePatch(path: string, initialPatch: string): string {
  const worktreePath = useAppStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    return ws?.worktreePath ?? null
  })
  const [patch, setPatch] = useState(initialPatch)

  useEffect(() => {
    setPatch(initialPatch)
  }, [initialPatch, path])

  useEffect(() => {
    if (initialPatch.trim() || !path.trim() || !worktreePath) return
    let cancelled = false
    void window.api.git.getFileDiff(worktreePath, path).then((text) => {
      if (!cancelled && text?.trim()) setPatch(text)
    })
    return () => {
      cancelled = true
    }
  }, [initialPatch, path, worktreePath])

  return patch
}
