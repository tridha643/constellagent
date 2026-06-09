import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/app-store'
import { useFileWatcher } from '../../hooks/useFileWatcher'
import type { DiffFileData, GitStatusSnapshot } from '../../types/working-tree-diff'
import { loadWorkingTreeDiffFiles } from '../Editor/loadWorkingTreeDiffFiles'
import { loadWorkingTreeExpandableDiffMetadata } from '../Editor/buildWorkingTreeDiffFileData'

const FILE_DIFF_LOAD_CONCURRENCY = 2
const STATUS_SNAPSHOT_TTL_MS = 5000

export interface WorkingTreeDiffState {
  files: DiffFileData[]
  loading: boolean
  expectedFileCount: number
  ensureFileDiffLoaded: (filePath: string) => void
  /** Increment before a self-induced FS write so the watcher refresh is swallowed. */
  markSelfInducedChange: () => void
  notifyGitFilesChanged: (paths: string[]) => void
}

/**
 * Working-tree diff loader — the data layer that feeds CodeView.
 * Wraps the KEPT `loadWorkingTreeDiffFiles` / `loadWorkingTreeExpandableDiffMetadata`
 * backends: warm-snapshot reuse, progressive per-file streaming, the lazy
 * expandable-metadata fetch queue (for "show full file"), and the FS watcher.
 * The render-windowing the retired DiffViewer wrapped around this is gone —
 * CodeView owns virtualization.
 */
export function useWorkingTreeDiff(opts: {
  worktreePath: string
  active: boolean
}): WorkingTreeDiffState {
  const { worktreePath, active } = opts

  const [files, setFiles] = useState<DiffFileData[]>([])
  const [loading, setLoading] = useState(true)
  const [expectedFileCount, setExpectedFileCount] = useState(0)

  const loadGenerationRef = useRef(0)
  const filesRef = useRef<DiffFileData[]>([])
  const fileDiffQueueRef = useRef<string[]>([])
  const fileDiffLoadingRef = useRef(new Set<string>())
  const fileDiffLoadedRef = useRef(new Set<string>())
  const fileDiffInFlightRef = useRef(0)
  const skippedWatcherRefreshesRef = useRef(0)

  const updateGitStatusSnapshot = useAppStore((s) => s.updateGitStatusSnapshot)
  const setWorkingTreeDiffSnapshot = useAppStore((s) => s.setWorkingTreeDiffSnapshot)

  useEffect(() => {
    filesRef.current = files
    for (const file of files) {
      if (file.fileDiff) fileDiffLoadedRef.current.add(file.filePath)
    }
  }, [files])

  // Reset per-file caches + content when the tab identity changes.
  useEffect(() => {
    return () => {
      fileDiffQueueRef.current = []
      fileDiffLoadingRef.current.clear()
      fileDiffLoadedRef.current.clear()
      fileDiffInFlightRef.current = 0
    }
  }, [worktreePath])

  const persistWorkingTreeSnapshot = useCallback(
    (snapshot: GitStatusSnapshot | null, nextFiles: DiffFileData[], complete: boolean) => {
      if (!snapshot) return
      setWorkingTreeDiffSnapshot(worktreePath, { ...snapshot, files: nextFiles, complete })
    },
    [setWorkingTreeDiffSnapshot, worktreePath],
  )

  const loadFiles = useCallback(async () => {
    const generation = ++loadGenerationRef.current
    const warmSnapshot = useAppStore.getState().workingTreeDiffSnapshots.get(worktreePath)
    const warmFiles = warmSnapshot?.files ?? []
    const canReuseWarmStatus =
      warmSnapshot != null && Date.now() - warmSnapshot.updatedAt < STATUS_SNAPSHOT_TTL_MS
    let resolvedSnapshot: GitStatusSnapshot | null = warmSnapshot ?? null
    if (warmSnapshot) setExpectedFileCount(warmSnapshot.statuses?.length ?? 0)
    if (warmFiles.length > 0) {
      setFiles(warmFiles)
      setLoading(false)
    }
    if (warmSnapshot?.complete && warmFiles.length > 0 && canReuseWarmStatus) {
      for (const file of warmFiles) {
        if (file.fileDiff) fileDiffLoadedRef.current.add(file.filePath)
      }
      return
    }
    try {
      const results = await loadWorkingTreeDiffFiles({
        worktreePath,
        source: 'diff-viewer',
        isCancelled: () => loadGenerationRef.current !== generation,
        statusSnapshot: canReuseWarmStatus ? warmSnapshot : undefined,
        onStatusSnapshot: (snapshot) => {
          if (loadGenerationRef.current !== generation) return
          resolvedSnapshot = snapshot
          setExpectedFileCount(snapshot.statuses.length)
          updateGitStatusSnapshot(worktreePath, snapshot)
        },
        onProgress: (nextFiles) => {
          if (loadGenerationRef.current !== generation) return
          setFiles(nextFiles)
          setLoading(false)
          persistWorkingTreeSnapshot(resolvedSnapshot, nextFiles, false)
        },
      })
      if (loadGenerationRef.current !== generation) return
      setFiles(results)
      setLoading(false)
      persistWorkingTreeSnapshot(resolvedSnapshot, results, true)
    } catch (err) {
      console.error('Failed to load diffs:', err)
    } finally {
      if (loadGenerationRef.current === generation) setLoading(false)
    }
  }, [worktreePath, updateGitStatusSnapshot, persistWorkingTreeSnapshot])

  const pumpFileDiffQueue = useCallback(() => {
    while (fileDiffInFlightRef.current < FILE_DIFF_LOAD_CONCURRENCY && fileDiffQueueRef.current.length > 0) {
      const filePath = fileDiffQueueRef.current.shift()
      if (!filePath) return
      if (fileDiffLoadedRef.current.has(filePath) || fileDiffLoadingRef.current.has(filePath)) continue
      const file = filesRef.current.find((entry) => entry.filePath === filePath)
      if (!file || !file.patch) continue

      const generation = loadGenerationRef.current
      fileDiffLoadingRef.current.add(filePath)
      fileDiffInFlightRef.current += 1
      void loadWorkingTreeExpandableDiffMetadata(worktreePath, file)
        .then((fileDiff) => {
          if (!fileDiff || loadGenerationRef.current !== generation) return
          fileDiffLoadedRef.current.add(filePath)
          setFiles((prev) => {
            const nextFiles = prev.map((entry) =>
              entry.filePath === filePath && !entry.fileDiff ? { ...entry, fileDiff } : entry,
            )
            const snapshot = useAppStore.getState().workingTreeDiffSnapshots.get(worktreePath)
            persistWorkingTreeSnapshot(snapshot ?? null, nextFiles, snapshot?.complete ?? false)
            return nextFiles
          })
        })
        .catch((error) => console.warn('Failed to load expandable diff metadata:', error))
        .finally(() => {
          fileDiffLoadingRef.current.delete(filePath)
          fileDiffInFlightRef.current -= 1
          pumpFileDiffQueue()
        })
    }
  }, [worktreePath, persistWorkingTreeSnapshot])

  const ensureFileDiffLoaded = useCallback((filePath: string) => {
    const file = filesRef.current.find((entry) => entry.filePath === filePath)
    if (!file || file.fileDiff || !file.patch) return
    if (fileDiffLoadedRef.current.has(filePath) || fileDiffLoadingRef.current.has(filePath)) return
    if (fileDiffQueueRef.current.includes(filePath)) return
    fileDiffQueueRef.current.push(filePath)
    pumpFileDiffQueue()
  }, [pumpFileDiffQueue])

  const notifyGitFilesChanged = useCallback((paths: string[]) => {
    window.dispatchEvent(new CustomEvent('git:files-changed', { detail: { worktreePath, paths } }))
  }, [worktreePath])

  const markSelfInducedChange = useCallback(() => {
    skippedWatcherRefreshesRef.current += 1
  }, [])

  const handleWatchedDirChange = useCallback(() => {
    if (skippedWatcherRefreshesRef.current > 0) {
      skippedWatcherRefreshesRef.current -= 1
      return
    }
    void loadFiles()
  }, [loadFiles])

  // Initial / activation load.
  useEffect(() => {
    if (!active) return
    const alreadyLoaded = filesRef.current.length > 0
    if (!alreadyLoaded) {
      setExpectedFileCount(0)
      setLoading(true)
    }
    void loadFiles()
  }, [active, loadFiles, worktreePath])

  useFileWatcher(worktreePath, handleWatchedDirChange, active)

  return {
    files,
    loading,
    expectedFileCount,
    ensureFileDiffLoaded,
    markSelfInducedChange,
    notifyGitFilesChanged,
  }
}
