import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import type { DiffAnnotation } from '@shared/diff-annotation-types'
import type { GitHunkActionRequest } from '@shared/git-hunk-action-types'
import { useAppStore } from '../../store/app-store'
import { useFileWatcher } from '../../hooks/useFileWatcher'
import type { GitStatusSnapshot } from '../../types/working-tree-diff'
import { isMarkdownDocumentPath } from '../../utils/markdown-path'
import { getPreferredScrollBehavior } from '../../utils/preferred-scroll-behavior'
import { extractFilePathFromGitPatchSegment, splitGitPatchIntoFiles } from '../../utils/git-patch'
import type { DiffFileData } from '../../types/working-tree-diff'
import { DiffFileSection, FileStrip } from './DiffFileSection'
import { loadWorkingTreeExpandableDiffMetadata } from './buildWorkingTreeDiffFileData'
import { loadWorkingTreeDiffFiles } from './loadWorkingTreeDiffFiles'
import { registerChangesFindSource } from '../../utils/changes-file-find-bridge'
import { markPaint, measureAsync } from '../../utils/perf'
import styles from './Editor.module.css'

interface Props {
  worktreePath: string
  active: boolean
  commitHash?: string
  commitMessage?: string
}

const FILE_DIFF_LOAD_CONCURRENCY = 2
const STATUS_SNAPSHOT_TTL_MS = 2000
const AUTO_COLLAPSE_FILE_THRESHOLD = 25
const AUTO_COLLAPSE_PATCH_LINE_THRESHOLD = 2000
const AUTO_EXPAND_MIN_FILES = 10
const AUTO_EXPAND_MAX_FILES = 15
const AUTO_EXPAND_PATCH_LINE_BUDGET = 1500

// ── Main DiffViewer ──

export function DiffViewer({ worktreePath, active, commitHash, commitMessage }: Props) {
  const [files, setFiles] = useState<DiffFileData[]>([])
  const [loading, setLoading] = useState(true)
  const [annotations, setAnnotations] = useState<DiffAnnotation[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [viewedFilePaths, setViewedFilePaths] = useState<Set<string>>(() => new Set())
  const [expectedFileCount, setExpectedFileCount] = useState(0)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const loadGenerationRef = useRef(0)
  const filesRef = useRef<DiffFileData[]>([])
  const fileDiffQueueRef = useRef<string[]>([])
  const fileDiffLoadingRef = useRef(new Set<string>())
  const fileDiffLoadedRef = useRef(new Set<string>())
  const fileDiffInFlightRef = useRef(0)
  const skippedWatcherRefreshesRef = useRef(0)
  const diffLoadStartedAtRef = useRef(0)
  const paintMarkedRef = useRef(false)
  const inline = useAppStore((s) => s.settings.diffInline)
  const defaultShowFullContext = useAppStore((s) => s.settings.diffShowFullContextByDefault)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const addToast = useAppStore((s) => s.addToast)
  const updateGitStatusSnapshot = useAppStore((s) => s.updateGitStatusSnapshot)
  const setWorkingTreeDiffSnapshot = useAppStore((s) => s.setWorkingTreeDiffSnapshot)

  const enableAcceptReject = !commitHash

  const setFileViewed = useCallback((filePath: string, viewed: boolean) => {
    setViewedFilePaths((prev) => {
      const next = new Set(prev)
      if (viewed) next.add(filePath)
      else next.delete(filePath)
      return next
    })
  }, [])

  useEffect(() => {
    setViewedFilePaths(new Set())
  }, [worktreePath, commitHash])

  const showViewedToggle = !commitHash

  useEffect(() => {
    filesRef.current = files
    for (const file of files) {
      if (file.fileDiff) fileDiffLoadedRef.current.add(file.filePath)
    }
  }, [files])

  const openFileFromDiff = useCallback(
    (fullPath: string) => {
      if (isMarkdownDocumentPath(fullPath)) openMarkdownPreview(fullPath)
      else openFileTab(fullPath)
    },
    [openFileTab, openMarkdownPreview],
  )

  const loadAnnotations = useCallback(async () => {
    try {
      const rows = await window.api.review.commentList(worktreePath)
      setAnnotations(
        rows.map((r) => ({
          id: r.id,
          filePath: r.file_path,
          side: r.side === 'old' ? 'deletions' as const : 'additions' as const,
          lineNumber: r.line_start,
          lineEnd: r.line_end !== r.line_start ? r.line_end : undefined,
          body: r.summary,
          rationale: r.rationale ?? undefined,
          createdAt: r.created_at,
          resolved: r.resolved,
          author: r.author ?? undefined,
        })),
      )
    } catch (err) {
      console.error('Failed to load review annotations:', err)
      setAnnotations([])
    }
  }, [worktreePath])

  useEffect(() => {
    void loadAnnotations()
  }, [loadAnnotations])

  const annotationsByFile = useMemo(() => {
    const grouped = new Map<string, DiffAnnotation[]>()
    for (const annotation of annotations) {
      const existing = grouped.get(annotation.filePath)
      if (existing) existing.push(annotation)
      else grouped.set(annotation.filePath, [annotation])
    }
    return grouped
  }, [annotations])

  const fileIndexByPath = useMemo(() => {
    const next = new Map<string, number>()
    files.forEach((file, index) => {
      next.set(file.filePath, index)
    })
    return next
  }, [files])

  const totalPatchLineCount = useMemo(
    () => files.reduce((sum, file) => sum + (file.patch ? file.patch.split('\n').length : 0), 0),
    [files],
  )

  const autoCollapseFiles = !commitHash && (
    expectedFileCount >= AUTO_COLLAPSE_FILE_THRESHOLD
    || totalPatchLineCount >= AUTO_COLLAPSE_PATCH_LINE_THRESHOLD
  )

  const defaultCollapsedPaths = useMemo(() => {
    const collapsed = new Set<string>()
    if (!autoCollapseFiles) return collapsed

    let expandedPatchLines = 0
    files.forEach((file, index) => {
      const patchLineCount = file.patch ? file.patch.split('\n').length : 0
      const shouldExpand =
        index < AUTO_EXPAND_MIN_FILES
        || (index < AUTO_EXPAND_MAX_FILES && expandedPatchLines + patchLineCount <= AUTO_EXPAND_PATCH_LINE_BUDGET)

      if (shouldExpand) expandedPatchLines += patchLineCount
      else collapsed.add(file.filePath)
    })

    return collapsed
  }, [autoCollapseFiles, files])

  const persistWorkingTreeSnapshot = useCallback((
    snapshot: GitStatusSnapshot | null,
    nextFiles: DiffFileData[],
    complete: boolean,
  ) => {
    if (!snapshot) return
    setWorkingTreeDiffSnapshot(worktreePath, {
      ...snapshot,
      files: nextFiles,
      complete,
    })
  }, [setWorkingTreeDiffSnapshot, worktreePath])

  const scrollToFile = useCallback((filePath: string) => {
    const index = fileIndexByPath.get(filePath)
    const root = scrollAreaRef.current
    if (index == null || !root) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(`diff-${filePath}`)
        el?.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: 'start' })
      })
    })
  }, [fileIndexByPath])

  useEffect(() => {
    if (!active) return
    return registerChangesFindSource('diff-tab', () => {
      if (files.length === 0) return null
      return {
        worktreePath,
        paths: files.map((f) => f.filePath),
        onPick: (path) => {
          scrollToFile(path)
        },
      }
    })
  }, [active, worktreePath, files, scrollToFile])

  // Reload when annotations are cleared (e.g. after PR merge)
  useEffect(() => {
    return window.api.review.onAnnotationsCleared(() => {
      void loadAnnotations()
    })
  }, [loadAnnotations])

  // ── GitHub PR comment loading ──
  useEffect(() => {
    if (commitHash) return // Don't load PR comments for commit diffs
    let cancelled = false
    ;(async () => {
      try {
        // Get current branch to look up PR
        const branch = await window.api.git.getCurrentBranch(worktreePath)
        if (!branch || cancelled) return

        // Check prStatusMap for a PR on this branch
        const { projects, workspaces, prStatusMap } = useAppStore.getState()
        const ws = workspaces.find((w) => w.worktreePath === worktreePath)
        if (!ws) return
        const project = projects.find((p) => p.id === ws.projectId)
        if (!project) return

        const prInfo = prStatusMap.get(`${project.id}:${branch}`)
        if (!prInfo?.number) return

        const comments = await window.api.github.getPrReviewComments(worktreePath, prInfo.number)
        if (cancelled) return
        const mapped: DiffAnnotation[] = comments.map((c) => ({
          id: c.id,
          filePath: c.filePath,
          side: c.diffSide === 'LEFT' ? ('deletions' as const) : ('additions' as const),
          lineNumber: c.line ?? c.startLine ?? 1,
          body: c.body,
          rationale: undefined,
          createdAt: c.createdAt,
          resolved: c.resolved,
          author: c.author,
        }))
        setAnnotations((prev) => [...prev, ...mapped])
      } catch (err) {
        console.error('Failed to load PR review comments:', err)
      }
    })()
    return () => { cancelled = true }
  }, [worktreePath, commitHash])

  const notifyGitFilesChanged = useCallback((paths: string[]) => {
    window.dispatchEvent(new CustomEvent('git:files-changed', {
      detail: { worktreePath, paths },
    }))
  }, [worktreePath])

  // Load commit-specific diff
  const loadCommitDiff = useCallback(async () => {
    if (!commitHash) return
    try {
      const patchOutput = await measureAsync('git:get-commit-diff', () => window.api.git.getCommitDiff(worktreePath, commitHash), {
        worktreePath,
        commitHash,
      })
      if (!patchOutput) {
        setFiles([])
        return
      }
      const parts = splitGitPatchIntoFiles(patchOutput)
      const results: DiffFileData[] = parts.map((part) => ({
        filePath: extractFilePathFromGitPatchSegment(part),
        patch: part,
        status: 'modified', // commit diffs don't distinguish status easily
      }))
      setFiles(results)
    } catch (err) {
      console.error('Failed to load commit diff:', err)
    } finally {
      setLoading(false)
    }
  }, [worktreePath, commitHash])

  // Load working-tree changed files
  const loadFiles = useCallback(async () => {
    if (commitHash) return // handled by loadCommitDiff
    const generation = ++loadGenerationRef.current
    const warmSnapshot = useAppStore.getState().workingTreeDiffSnapshots.get(worktreePath)
    const warmFiles = warmSnapshot?.files ?? []
    const canReuseWarmStatus = warmSnapshot != null && (Date.now() - warmSnapshot.updatedAt) < STATUS_SNAPSHOT_TTL_MS
    let resolvedSnapshot: GitStatusSnapshot | null = warmSnapshot ?? null
    if (warmSnapshot) {
      setExpectedFileCount(warmSnapshot.statuses.length)
    }
    if (warmFiles.length > 0) {
      setFiles(warmFiles)
      setLoading(false)
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
      if (loadGenerationRef.current === generation) {
        setLoading(false)
      }
    }
  }, [worktreePath, commitHash, updateGitStatusSnapshot, persistWorkingTreeSnapshot])

  // ── Git operations for accept/reject ──
  const applyHunkAction = useCallback(
    async (request: GitHunkActionRequest) => {
      skippedWatcherRefreshesRef.current += 1
      try {
        await window.api.git.applyHunkAction(worktreePath, request)
        notifyGitFilesChanged([request.filePath])
      } catch (err) {
        skippedWatcherRefreshesRef.current = Math.max(0, skippedWatcherRefreshesRef.current - 1)
        const verb = request.action === 'keep' ? 'keep' : 'undo'
        console.error(`Failed to ${verb} hunk:`, err)
        addToast({
          id: `hunk-${request.action}-err-${Date.now()}`,
          message: `Failed to ${verb} selected hunk in ${request.filePath}`,
          type: 'error',
        })
        throw err
      }
    },
    [worktreePath, notifyGitFilesChanged, addToast],
  )

  const handleWatchedDirChange = useCallback(() => {
    if (skippedWatcherRefreshesRef.current > 0) {
      skippedWatcherRefreshesRef.current -= 1
      return
    }
    void loadFiles()
  }, [loadFiles])

  useEffect(() => {
    fileDiffQueueRef.current = []
    fileDiffLoadingRef.current.clear()
    fileDiffLoadedRef.current.clear()
    fileDiffInFlightRef.current = 0
    diffLoadStartedAtRef.current = performance.now()
    paintMarkedRef.current = false
    setExpectedFileCount(0)
    scrollAreaRef.current?.scrollTo({ top: 0 })
    setLoading(true)
    if (commitHash) {
      void loadCommitDiff()
    } else {
      void loadFiles()
    }
  }, [commitHash, loadCommitDiff, loadFiles])

  // Auto-refresh on filesystem changes (only for working-tree diffs)
  useFileWatcher(worktreePath, handleWatchedDirChange, !commitHash)

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
      void measureAsync('diff:load-expandable-file', () => loadWorkingTreeExpandableDiffMetadata(worktreePath, file), {
        worktreePath,
        filePath,
      }).then((fileDiff) => {
        if (!fileDiff) return
        if (loadGenerationRef.current !== generation) return
        fileDiffLoadedRef.current.add(filePath)
        setFiles((prev) => {
          const nextFiles = prev.map((entry) => (
            entry.filePath === filePath && !entry.fileDiff
              ? { ...entry, fileDiff }
              : entry
          ))
          const snapshot = useAppStore.getState().workingTreeDiffSnapshots.get(worktreePath)
          persistWorkingTreeSnapshot(snapshot ?? null, nextFiles, snapshot?.complete ?? false)
          return nextFiles
        })
      }).catch((error) => {
        console.warn('Failed to load expandable diff metadata:', error)
      }).finally(() => {
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

  // Listen for scroll-to-file events from ChangedFiles panel
  useEffect(() => {
    const handler = (e: Event) => {
      const filePath = (e as CustomEvent<string>).detail
      scrollToFile(filePath)
    }
    window.addEventListener('diff:scrollToFile', handler)
    return () => window.removeEventListener('diff:scrollToFile', handler)
  }, [scrollToFile])

  useEffect(() => {
    const root = scrollAreaRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id
            if (id.startsWith('diff-')) {
              setActiveFile(id.slice(5))
            }
          }
        }
      },
      { root, threshold: 0.3 },
    )

    for (const file of files) {
      const el = document.getElementById(`diff-${file.filePath}`)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [files])

  useEffect(() => {
    if (!active) return
    if (files.length === 0) return
    if (paintMarkedRef.current) return
    paintMarkedRef.current = true
    markPaint('workspace-switch-diff-ready', diffLoadStartedAtRef.current, {
      worktreePath,
      fileCount: files.length,
      commitHash: commitHash ?? null,
    })
  }, [active, files.length, worktreePath, commitHash])

  if (loading && files.length === 0) {
    return (
      <div className={styles.diffViewerContainer}>
        <div className={styles.diffEmpty}>
          <span className={styles.diffEmptyText}>Loading changes...</span>
        </div>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className={styles.diffViewerContainer}>
        <div className={styles.diffEmpty}>
          <span className={styles.diffEmptyIcon}>&#10003;</span>
          <span className={styles.diffEmptyText}>No changes</span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.diffViewerContainer}>
      {/* Toolbar */}
      <div className={styles.diffToolbar}>
        <span className={styles.diffFileCount}>
          {commitHash
            ? `${commitHash.slice(0, 7)} ${commitMessage || ''}`
            : `${files.length} changed file${files.length !== 1 ? 's' : ''}`
          }
        </span>
        {loading && files.length > 0 && (
          <span className={styles.diffFileCount}>Loading remaining changes...</span>
        )}
        {autoCollapseFiles && (
          <span className={styles.diffFileCount}>First files expanded, remaining files collapsed for performance</span>
        )}
        <div className={styles.diffToggle}>
          <button
            className={`${styles.diffToggleOption} ${!inline ? styles.active : ''}`}
            onClick={() => updateSettings({ diffInline: false })}
          >
            Side by side
          </button>
          <button
            className={`${styles.diffToggleOption} ${inline ? styles.active : ''}`}
            onClick={() => updateSettings({ diffInline: true })}
          >
            Inline
          </button>
        </div>
      </div>

      <p className={styles.diffCommentHint}>
        Hover a line and click + to comment, or drag across line numbers for a range.
      </p>

      {/* File strip */}
      <FileStrip
        files={files}
        activeFile={activeFile}
        onSelectFile={scrollToFile}
        viewedFilePaths={showViewedToggle ? viewedFilePaths : undefined}
      />

      {/* Stacked diffs */}
      <div ref={scrollAreaRef} className={styles.diffScrollArea}>
        {files.map((file) => (
          <DiffFileSection
            key={file.filePath}
            data={file}
            defaultCollapsed={defaultCollapsedPaths.has(file.filePath)}
            inline={inline}
            defaultShowFullContext={defaultShowFullContext}
            worktreePath={worktreePath}
            onOpenFile={openFileFromDiff}
            fileAnnotations={annotationsByFile.get(file.filePath) ?? []}
            onAnnotationsChanged={loadAnnotations}
            showPatchAnchorNote={!!commitHash}
            enableAcceptReject={enableAcceptReject}
            onHunkAccepted={applyHunkAction}
            onHunkRejected={applyHunkAction}
            onEnsureFileDiff={commitHash ? undefined : ensureFileDiffLoaded}
            enableViewedToggle={showViewedToggle}
            viewed={viewedFilePaths.has(file.filePath)}
            onViewedChange={(v) => setFileViewed(file.filePath, v)}
          />
        ))}
      </div>
    </div>
  )
}
