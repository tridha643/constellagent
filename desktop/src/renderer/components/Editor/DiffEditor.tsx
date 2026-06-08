import {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'react'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import type { AnnotationPatch, DiffAnnotation } from '@shared/diff-annotation-types'
import type { GitHunkActionRequest } from '@shared/git-hunk-action-types'
import { useAppStore } from '../../store/app-store'
import { useFileWatcher } from '../../hooks/useFileWatcher'
import type { GitStatusSnapshot } from '../../types/working-tree-diff'
import { isMarkdownDocumentPath } from '../../utils/markdown-path'
import { getPreferredScrollBehavior } from '../../utils/preferred-scroll-behavior'
import { extractFilePathFromGitPatchSegment, splitGitPatchIntoFiles } from '../../utils/git-patch'
import type { DiffFileData } from '../../types/working-tree-diff'
import { DiffFileSection, FileStrip } from './DiffFileSection'
import { isDiffCommentDraftDirty, type DiffCommentDraft } from './diff-comment-draft'
import { loadWorkingTreeExpandableDiffMetadata } from './buildWorkingTreeDiffFileData'
import { loadWorkingTreeDiffFiles } from './loadWorkingTreeDiffFiles'
import { registerChangesFindSource } from '../../utils/changes-file-find-bridge'
import { markPaint, measureAsync } from '../../utils/perf'
import { CODEX_ABSOLUTELY_DIFF_THEME_ID } from '../../themes/diff/codex-absolutely-dark'
import { createPierreDiffWorker } from '../../utils/pierre-diff-worker'
import {
  buildDiffFileVirtualLayout,
  ensureFileInVirtualWindow,
  findHeaderOwningFileSection,
  getDiffFileReviewLineCount,
  getDiffReviewSummary,
  getScrollTopForFileHeader,
  getVirtualDiffFileWindow,
} from './diff-viewer-model'
import styles from './Editor.module.css'

const EMPTY_ANNS: DiffAnnotation[] = []
const DIFF_FILE_OVERSCAN_PX = 1600
const DEFAULT_DIFF_VIEWPORT_HEIGHT = 900

interface Props {
  worktreePath: string
  active: boolean
  commitHash?: string
  commitMessage?: string
}

const FILE_DIFF_LOAD_CONCURRENCY = 2
const STATUS_SNAPSHOT_TTL_MS = 5000
const AUTO_COLLAPSE_FILE_THRESHOLD = 25
const AUTO_COLLAPSE_PATCH_LINE_THRESHOLD = 2000
const AUTO_EXPAND_MIN_FILES = 10
const AUTO_EXPAND_MAX_FILES = 15
const AUTO_EXPAND_PATCH_LINE_BUDGET = 1500

/**
 * Merge a refreshed list of libSQL annotations into the prior in-memory list,
 * preserving existing object identity for rows whose visible fields are
 * unchanged. Keeps memos/Pierre anchors stable across drift reconciliation.
 */
function mergeDiffEditorAnnotations(
  prev: DiffAnnotation[],
  next: DiffAnnotation[],
): DiffAnnotation[] {
  const prevById = new Map(prev.map((a) => [a.id, a]))
  let changed = prev.length !== next.length
  const merged = next.map((row) => {
    const existing = prevById.get(row.id)
    if (
      existing &&
      existing.body === row.body &&
      existing.resolved === row.resolved &&
      existing.lineNumber === row.lineNumber &&
      existing.lineEnd === row.lineEnd &&
      existing.filePath === row.filePath &&
      existing.side === row.side &&
      existing.author === row.author &&
      existing.createdAt === row.createdAt &&
      existing.rationale === row.rationale
    ) {
      return existing
    }
    changed = true
    return row
  })
  return changed ? merged : prev
}

// ── Main DiffViewer ──

export function DiffViewer({ worktreePath, active, commitHash, commitMessage }: Props) {
  const [files, setFiles] = useState<DiffFileData[]>([])
  const [loading, setLoading] = useState(true)
  // Split libSQL annotations from GitHub PR comments so a libSQL reconcile
  // never clobbers PR rows merged in by the effect below. The combined
  // `annotations` array (memoized) is what the UI consumes.
  const [localAnnotations, setLocalAnnotations] = useState<DiffAnnotation[]>([])
  const [prAnnotations, setPrAnnotations] = useState<DiffAnnotation[]>([])
  const annotations = useMemo(
    () => [...localAnnotations, ...prAnnotations],
    [localAnnotations, prAnnotations],
  )
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [viewedFilePaths, setViewedFilePaths] = useState<Set<string>>(() => new Set())
  const [collapsedFileOverrides, setCollapsedFileOverrides] = useState<Map<string, boolean>>(() => new Map())
  const [expectedFileCount, setExpectedFileCount] = useState(0)
  const [commentDraftsByFile, setCommentDraftsByFile] = useState<Map<string, DiffCommentDraft>>(() => new Map())
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const defaultCollapsedPathsRef = useRef<ReadonlySet<string>>(new Set())
  const virtualLayoutRef = useRef<ReturnType<typeof buildDiffFileVirtualLayout>>([])
  const virtualWindowRef = useRef({ startIndex: 0, endIndex: 0 })
  const savedScrollTopRef = useRef(0)
  const loadGenerationRef = useRef(0)
  const reconcileGenerationRef = useRef(0)
  const filesRef = useRef<DiffFileData[]>([])
  const scrollRafRef = useRef<number | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [scrollTargetFilePath, setScrollTargetFilePath] = useState<string | null>(null)
  const [scrollRequest, setScrollRequest] = useState<{ filePath: string; token: number } | null>(null)
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_DIFF_VIEWPORT_HEIGHT)
  const suppressViewportSelectionSyncRef = useRef(false)
  const [measuredFileHeights, setMeasuredFileHeights] = useState<Map<string, number>>(() => new Map())
  const measuredFileHeightsRef = useRef(measuredFileHeights)
  const pendingHeightUpdatesRef = useRef(new Map<string, number>())
  const heightFlushRafRef = useRef<number | null>(null)
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
  const toggleHunkReview = useAppStore((s) => s.toggleHunkReview)
  const closeHunkReview = useAppStore((s) => s.closeHunkReview)
  const hunkReviewOpen = useAppStore((s) => s.hunkReviewOpen)
  const hunkReviewWorkspaceId = useAppStore((s) => s.hunkReviewWorkspaceId)
  const workspaces = useAppStore((s) => s.workspaces)
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const addToast = useAppStore((s) => s.addToast)
  const updateGitStatusSnapshot = useAppStore((s) => s.updateGitStatusSnapshot)
  const setWorkingTreeDiffSnapshot = useAppStore((s) => s.setWorkingTreeDiffSnapshot)

  const enableAcceptReject = !commitHash
  const reviewWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.worktreePath === worktreePath),
    [workspaces, worktreePath],
  )

  const openReviewDrawer = useCallback(() => {
    if (hunkReviewOpen && hunkReviewWorkspaceId === reviewWorkspace?.id) return
    if (hunkReviewOpen) {
      closeHunkReview()
      requestAnimationFrame(() => { void toggleHunkReview() })
      return
    }
    void toggleHunkReview()
  }, [closeHunkReview, hunkReviewOpen, hunkReviewWorkspaceId, reviewWorkspace?.id, toggleHunkReview])

  const setFileCollapsed = useCallback((filePath: string, collapsed: boolean) => {
    setCollapsedFileOverrides((prev) => {
      const defaultCollapsed = defaultCollapsedPathsRef.current.has(filePath)
      const existing = prev.get(filePath)
      if (existing === collapsed) return prev
      if (!prev.has(filePath) && defaultCollapsed === collapsed) return prev

      const next = new Map(prev)
      if (collapsed === defaultCollapsed) next.delete(filePath)
      else next.set(filePath, collapsed)
      return next
    })
  }, [])

  const setFileViewed = useCallback((filePath: string, viewed: boolean) => {
    setViewedFilePaths((prev) => {
      const next = new Set(prev)
      if (viewed) next.add(filePath)
      else next.delete(filePath)
      return next
    })
    if (viewed) setFileCollapsed(filePath, true)
  }, [setFileCollapsed])

  useEffect(() => {
    setViewedFilePaths(new Set())
    setCollapsedFileOverrides(new Map())
    setCommentDraftsByFile(new Map())
    setMeasuredFileHeights(new Map())
    measuredFileHeightsRef.current = new Map()
    pendingHeightUpdatesRef.current.clear()
    savedScrollTopRef.current = 0
    setScrollTop(0)
    scrollAreaRef.current?.scrollTo({ top: 0 })
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

  // Local-first reconciliation (see HunkReview for the canonical pattern). The
  // standalone diff tab uses the same approach so its comment writes don't
  // flicker either.
  const reconcileAnnotations = useCallback(async () => {
    const generation = ++reconcileGenerationRef.current
    try {
      const rows = await window.api.review.commentList(worktreePath)
      if (reconcileGenerationRef.current !== generation) return
      const next: DiffAnnotation[] = rows.map((r) => ({
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
      }))
      setLocalAnnotations((prev) => mergeDiffEditorAnnotations(prev, next))
    } catch (err) {
      console.error('Failed to load review annotations:', err)
    }
  }, [worktreePath])

  useEffect(() => {
    if (!active) return
    void reconcileAnnotations()
  }, [active, reconcileAnnotations])

  const applyAnnotationPatch = useCallback((patch: AnnotationPatch) => {
    setLocalAnnotations((prev) => {
      switch (patch.type) {
        case 'insert':
          if (prev.some((a) => a.id === patch.annotation.id)) return prev
          return [...prev, patch.annotation]
        case 'update': {
          let mutated = false
          const next = prev.map((a) => {
            if (a.id !== patch.id) return a
            mutated = true
            return { ...a, ...patch.changes }
          })
          return mutated ? next : prev
        }
        case 'remove': {
          const next = prev.filter((a) => a.id !== patch.id)
          return next.length === prev.length ? prev : next
        }
        case 'rollback-insert': {
          const next = prev.filter((a) => a.id !== patch.id)
          return next.length === prev.length ? prev : next
        }
        case 'rollback-restore':
          if (prev.some((a) => a.id === patch.annotation.id)) return prev
          return [...prev, patch.annotation]
        default:
          return prev
      }
    })
  }, [])

  // Drift reconcile: window focus + git changes (no polling).
  useEffect(() => {
    const onFocus = () => { void reconcileAnnotations() }
    const onGitChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ worktreePath?: string }>).detail
      if (detail?.worktreePath && detail.worktreePath !== worktreePath) return
      void reconcileAnnotations()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('git:files-changed', onGitChanged)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('git:files-changed', onGitChanged)
    }
  }, [reconcileAnnotations, worktreePath])

  const annotationsByFile = useMemo(() => {
    const grouped = new Map<string, DiffAnnotation[]>()
    for (const annotation of annotations) {
      const existing = grouped.get(annotation.filePath)
      if (existing) existing.push(annotation)
      else grouped.set(annotation.filePath, [annotation])
    }
    return grouped
  }, [annotations])

  const totalPatchLineCount = useMemo(
    () => files.reduce((sum, file) => sum + getDiffFileReviewLineCount(file), 0),
    [files],
  )

  const reviewSummary = useMemo(() => getDiffReviewSummary(files), [files])

  const autoCollapseFiles = !commitHash && (
    expectedFileCount >= AUTO_COLLAPSE_FILE_THRESHOLD
    || totalPatchLineCount >= AUTO_COLLAPSE_PATCH_LINE_THRESHOLD
  )

  const defaultCollapsedPaths = useMemo(() => {
    const collapsed = new Set<string>()
    if (!autoCollapseFiles) return collapsed

    let expandedPatchLines = 0
    files.forEach((file, index) => {
      const patchLineCount = getDiffFileReviewLineCount(file)
      const shouldExpand =
        index < AUTO_EXPAND_MIN_FILES
        || (index < AUTO_EXPAND_MAX_FILES && expandedPatchLines + patchLineCount <= AUTO_EXPAND_PATCH_LINE_BUDGET)

      if (shouldExpand) expandedPatchLines += patchLineCount
      else collapsed.add(file.filePath)
    })

    return collapsed
  }, [autoCollapseFiles, files])

  useEffect(() => {
    defaultCollapsedPathsRef.current = defaultCollapsedPaths
  }, [defaultCollapsedPaths])

  const effectiveCollapsedPaths = useMemo(() => {
    const collapsed = new Set(defaultCollapsedPaths)
    for (const [filePath, isCollapsed] of collapsedFileOverrides) {
      if (isCollapsed) collapsed.add(filePath)
      else collapsed.delete(filePath)
    }
    return collapsed
  }, [collapsedFileOverrides, defaultCollapsedPaths])

  const virtualLayout = useMemo(
    () => buildDiffFileVirtualLayout(files, effectiveCollapsedPaths, measuredFileHeights),
    [effectiveCollapsedPaths, files, measuredFileHeights],
  )

  useEffect(() => {
    virtualLayoutRef.current = virtualLayout
  }, [virtualLayout])

  const virtualWindow = useMemo(() => {
    const base = getVirtualDiffFileWindow(virtualLayout, scrollTop, viewportHeight, DIFF_FILE_OVERSCAN_PX)
    if (!scrollTargetFilePath) return base
    return ensureFileInVirtualWindow(base, virtualLayout, scrollTargetFilePath)
  }, [scrollTop, scrollTargetFilePath, viewportHeight, virtualLayout])

  useEffect(() => {
    virtualWindowRef.current = {
      startIndex: virtualWindow.startIndex,
      endIndex: virtualWindow.endIndex,
    }
  }, [virtualWindow.endIndex, virtualWindow.startIndex])

  const visibleWindowFiles = useMemo(
    () => virtualWindow.items.map((item) => item.file),
    [virtualWindow],
  )

  const flushMeasuredHeights = useCallback(() => {
    heightFlushRafRef.current = null
    const pending = pendingHeightUpdatesRef.current
    if (pending.size === 0) return
    const snapshot = new Map(pending)
    pending.clear()
    setMeasuredFileHeights((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const [filePath, height] of snapshot) {
        if (next.get(filePath) === height) continue
        next.set(filePath, height)
        changed = true
      }
      if (!changed) return prev
      measuredFileHeightsRef.current = next
      return next
    })
  }, [])

  const handleMeasuredHeightChange = useCallback((filePath: string, height: number) => {
    pendingHeightUpdatesRef.current.set(filePath, height)
    if (heightFlushRafRef.current != null) return
    heightFlushRafRef.current = requestAnimationFrame(flushMeasuredHeights)
  }, [flushMeasuredHeights])

  const scrollContentHeight = useMemo(() => {
    if (virtualLayout.length === 0) return 0
    const last = virtualLayout[virtualLayout.length - 1]!
    return last.top + last.height
  }, [virtualLayout])

  const pendingRangeHandlers = useMemo(() => {
    const handlers = new Map<string, {
      pendingRange: DiffPendingCommentRange | null
      composerBody: string
      composerDirty: boolean
      onPendingRangeChange: (range: DiffPendingCommentRange | null) => void
      onComposerBodyChange: (body: string) => void
      onComposerDirtyChange: (dirty: boolean) => void
    }>()
    for (const file of files) {
      const filePath = file.filePath
      const draft = commentDraftsByFile.get(filePath)
      handlers.set(filePath, {
        pendingRange: draft?.range ?? null,
        composerBody: draft?.body ?? '',
        composerDirty: isDiffCommentDraftDirty(draft),
        onPendingRangeChange: (range) => {
          setCommentDraftsByFile((prev) => {
            const next = new Map(prev)
            if (range == null) {
              next.delete(filePath)
              return next.size === prev.size ? prev : next
            }
            const existing = next.get(filePath)
            if (existing?.range.side === range.side
              && existing.range.lineNumber === range.lineNumber
              && existing.range.lineEnd === range.lineEnd
              && !isDiffCommentDraftDirty(existing)) {
              return prev
            }
            next.set(filePath, { range, body: existing?.body ?? '' })
            return next
          })
        },
        onComposerBodyChange: (body) => {
          setCommentDraftsByFile((prev) => {
            const existing = prev.get(filePath)
            if (!existing || existing.body === body) return prev
            const next = new Map(prev)
            next.set(filePath, { ...existing, body })
            return next
          })
        },
        onComposerDirtyChange: (dirty) => {
          setCommentDraftsByFile((prev) => {
            const existing = prev.get(filePath)
            if (!existing) {
              if (!dirty) return prev
              return prev
            }
            if (isDiffCommentDraftDirty(existing) === dirty) return prev
            return prev
          })
        },
      })
    }
    return handlers
  }, [commentDraftsByFile, files])

  const pierreWorkerPoolOptions = useMemo(
    () => ({
      poolOptions: {
        workerFactory: createPierreDiffWorker,
        poolSize: 4,
      },
      highlighterOptions: {
        theme: CODEX_ABSOLUTELY_DIFF_THEME_ID,
        lineDiffType: 'word-alt' as const,
        tokenizeMaxLineLength: 2000,
        maxLineDiffLength: 2000,
        preferredHighlighter: 'shiki-js' as const,
      },
    }),
    [],
  )

  const collapsedChangeHandlers = useMemo(() => {
    const handlers = new Map<string, (collapsed: boolean) => void>()
    for (const file of files) {
      handlers.set(file.filePath, (collapsed: boolean) => setFileCollapsed(file.filePath, collapsed))
    }
    return handlers
  }, [files, setFileCollapsed])

  const viewedChangeHandlers = useMemo(() => {
    const handlers = new Map<string, (viewed: boolean) => void>()
    for (const file of files) {
      handlers.set(file.filePath, (viewed: boolean) => setFileViewed(file.filePath, viewed))
    }
    return handlers
  }, [files, setFileViewed])

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
    if (effectiveCollapsedPaths.has(filePath)) {
      setFileCollapsed(filePath, false)
    }
    setActiveFile(filePath)
    setScrollRequest({ filePath, token: Date.now() })
  }, [effectiveCollapsedPaths, setFileCollapsed])

  useLayoutEffect(() => {
    if (!scrollRequest || !active) return
    const { filePath } = scrollRequest
    const layout = virtualLayoutRef.current
    const root = scrollAreaRef.current
    const viewport = root?.clientHeight || viewportHeight || DEFAULT_DIFF_VIEWPORT_HEIGHT
    const targetTop = getScrollTopForFileHeader(layout, filePath, viewport)
    if (targetTop == null) return

    const nextWindow = ensureFileInVirtualWindow(
      getVirtualDiffFileWindow(layout, targetTop, viewport, DIFF_FILE_OVERSCAN_PX),
      layout,
      filePath,
    )
    virtualWindowRef.current = {
      startIndex: nextWindow.startIndex,
      endIndex: nextWindow.endIndex,
    }
    suppressViewportSelectionSyncRef.current = true
    setScrollTargetFilePath(filePath)
    setScrollTop(targetTop)
    savedScrollTopRef.current = targetTop

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scrollRoot = scrollAreaRef.current
        if (!scrollRoot) return
        scrollRoot.scrollTo({ top: targetTop, behavior: getPreferredScrollBehavior() })
        const section = document.getElementById(`diff-${filePath}`)
        section?.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: 'start' })
        setScrollRequest(null)
        window.setTimeout(() => {
          suppressViewportSelectionSyncRef.current = false
          setScrollTargetFilePath(null)
        }, 200)
      })
    })
  }, [active, scrollRequest, viewportHeight])

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
      void reconcileAnnotations()
    })
  }, [reconcileAnnotations])

  // ── GitHub PR comment loading ──
  useEffect(() => {
    if (!active || commitHash) return // Don't load PR comments for commit diffs
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
        setPrAnnotations(mapped)
      } catch (err) {
        console.error('Failed to load PR review comments:', err)
      }
    })()
    return () => { cancelled = true }
  }, [active, worktreePath, commitHash])

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
      setExpectedFileCount(warmSnapshot.statuses?.length ?? 0)
    }
    if (warmFiles.length > 0) {
      setFiles(warmFiles)
      setLoading(false)
    }
    if (warmSnapshot?.complete && warmFiles.length > 0 && canReuseWarmStatus) {
      for (const file of warmFiles) {
        if (file.fileDiff) fileDiffLoadedRef.current.add(file.filePath)
      }
      return warmFiles
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
    if (!active) return

    const warmSnapshot = useAppStore.getState().workingTreeDiffSnapshots.get(worktreePath)
    const warmFiles = warmSnapshot?.files ?? []
    const canReuseWarmComplete = !commitHash
      && warmSnapshot?.complete
      && warmFiles.length > 0
      && (Date.now() - warmSnapshot.updatedAt) < STATUS_SNAPSHOT_TTL_MS

    const alreadyLoaded = filesRef.current.length > 0

    if (!alreadyLoaded) {
      fileDiffQueueRef.current = []
      fileDiffLoadingRef.current.clear()
      fileDiffLoadedRef.current.clear()
      fileDiffInFlightRef.current = 0
      diffLoadStartedAtRef.current = performance.now()
      paintMarkedRef.current = false

      if (canReuseWarmComplete && warmSnapshot) {
        setExpectedFileCount(warmSnapshot.statuses?.length ?? 0)
        setFiles(warmFiles)
        setLoading(false)
        for (const file of warmFiles) {
          if (file.fileDiff) fileDiffLoadedRef.current.add(file.filePath)
        }
      } else {
        setExpectedFileCount(0)
        scrollAreaRef.current?.scrollTo({ top: 0 })
        setLoading(true)
      }
    } else {
      diffLoadStartedAtRef.current = performance.now()
      paintMarkedRef.current = false
    }

    if (commitHash) {
      void loadCommitDiff()
    } else {
      void loadFiles()
    }
  }, [active, commitHash, loadCommitDiff, loadFiles, worktreePath])

  // Auto-refresh on filesystem changes (only for active working-tree diffs)
  useFileWatcher(worktreePath, handleWatchedDirChange, active && !commitHash)

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
    if (!active) {
      savedScrollTopRef.current = root.scrollTop
      return
    }
    if (!scrollRequest) {
      root.scrollTop = savedScrollTopRef.current
    }
    const onScroll = () => {
      if (scrollRafRef.current != null) return
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null
        const nextTop = root.scrollTop
        if (!suppressViewportSelectionSyncRef.current) {
          const owner = findHeaderOwningFileSection(virtualLayoutRef.current, nextTop)
          if (owner) setActiveFile(owner.filePath)
        }

        const nextWindow = getVirtualDiffFileWindow(
          virtualLayoutRef.current,
          nextTop,
          root.clientHeight || DEFAULT_DIFF_VIEWPORT_HEIGHT,
          DIFF_FILE_OVERSCAN_PX,
        )
        const prev = virtualWindowRef.current
        if (prev.startIndex === nextWindow.startIndex && prev.endIndex === nextWindow.endIndex) {
          return
        }
        virtualWindowRef.current = {
          startIndex: nextWindow.startIndex,
          endIndex: nextWindow.endIndex,
        }
        setScrollTop(nextTop)
      })
    }
    onScroll()
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      root.removeEventListener('scroll', onScroll)
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
  }, [active, files.length, commitHash, scrollRequest])

  useEffect(() => {
    const root = scrollAreaRef.current
    if (!root || !active) return
    const syncViewportHeight = () => {
      setViewportHeight(root.clientHeight || DEFAULT_DIFF_VIEWPORT_HEIGHT)
    }
    syncViewportHeight()
    const observer = new ResizeObserver(syncViewportHeight)
    observer.observe(root)
    return () => observer.disconnect()
  }, [active, files.length, commitHash])

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

  const viewerContainerClass = active
    ? styles.diffViewerContainer
    : `${styles.diffViewerContainer} ${styles.inactive}`

  if (loading && files.length === 0) {
    return (
      <div className={viewerContainerClass}>
        <div className={styles.diffEmpty}>
          <span className={styles.diffEmptyText}>Loading changes...</span>
        </div>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className={viewerContainerClass}>
        <div className={styles.diffEmpty}>
          <span className={styles.diffEmptyIcon}>&#10003;</span>
          <span className={styles.diffEmptyText}>No changes</span>
        </div>
      </div>
    )
  }

  return (
    <div className={viewerContainerClass}>
      {/* Toolbar */}
      <div className={styles.diffToolbar}>
        <div className={styles.diffReviewSummary}>
          <span className={`${styles.diffSummaryPrimary} ${styles.diffFileCount}`}>
            {commitHash
              ? `${commitHash.slice(0, 7)} ${commitMessage || ''}`
              : `${files.length} file${files.length !== 1 ? 's' : ''}`
            }
          </span>
          {!commitHash && (
            <>
              <span className={styles.diffSummaryPill}>{viewedFilePaths.size}/{files.length} viewed</span>
              <span className={styles.diffSummaryAdd}>+{reviewSummary.additions}</span>
              <span className={styles.diffSummaryDel}>-{reviewSummary.deletions}</span>
              <span className={styles.diffSummaryPill}>{reviewSummary.staged} staged</span>
              <span className={styles.diffSummaryPill}>{reviewSummary.unstaged} unstaged</span>
            </>
          )}
          {loading && files.length > 0 && (
            <span className={styles.diffSummaryMuted}>Loading remaining changes...</span>
          )}
          {autoCollapseFiles && (
            <span className={styles.diffSummaryMuted}>First files expanded, remaining files collapsed for performance</span>
          )}
        </div>
        <div className={styles.diffControlsRight}>
          {!commitHash && (
            <button
              type="button"
              className={styles.diffReviewButton}
              onClick={openReviewDrawer}
            >
              Review
            </button>
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
      </div>

      <p className={styles.diffCommentHint}>
        Hover a line and click + to comment, or drag across the code or line numbers for a range.
      </p>

      {/* File strip */}
      <FileStrip
        files={files}
        activeFile={activeFile}
        onSelectFile={scrollToFile}
        viewedFilePaths={showViewedToggle ? viewedFilePaths : undefined}
      />

      {/* Stacked diffs — file-level windowing only (no Pierre line Virtualizer; matches HunkReview). */}
      <div ref={scrollAreaRef} className={styles.diffScrollArea}>
        <div className={styles.diffScrollContent}>
          {active ? (
            <WorkerPoolContextProvider {...pierreWorkerPoolOptions}>
              {virtualWindow.beforeHeight > 0 && (
                <div style={{ height: virtualWindow.beforeHeight }} aria-hidden />
              )}
              {visibleWindowFiles.map((file) => {
                const draftHandlers = pendingRangeHandlers.get(file.filePath)
                return (
                  <DiffFileSection
                    key={file.filePath}
                    data={file}
                    defaultCollapsed={defaultCollapsedPaths.has(file.filePath)}
                    collapsed={effectiveCollapsedPaths.has(file.filePath)}
                    onCollapsedChange={collapsedChangeHandlers.get(file.filePath)}
                    inline={inline}
                    defaultShowFullContext={defaultShowFullContext}
                    worktreePath={worktreePath}
                    onOpenFile={openFileFromDiff}
                    fileAnnotations={annotationsByFile.get(file.filePath) ?? EMPTY_ANNS}
                    onApplyAnnotation={applyAnnotationPatch}
                    showPatchAnchorNote={!!commitHash}
                    enableAcceptReject={enableAcceptReject}
                    onHunkAccepted={applyHunkAction}
                    onHunkRejected={applyHunkAction}
                    onEnsureFileDiff={commitHash ? undefined : ensureFileDiffLoaded}
                    enableViewedToggle={showViewedToggle}
                    viewed={viewedFilePaths.has(file.filePath)}
                    onViewedChange={viewedChangeHandlers.get(file.filePath)}
                    onMeasuredHeightChange={handleMeasuredHeightChange}
                    pendingRange={draftHandlers?.pendingRange ?? null}
                    onPendingRangeChange={draftHandlers?.onPendingRangeChange}
                    composerBody={draftHandlers?.composerBody ?? ''}
                    onComposerBodyChange={draftHandlers?.onComposerBodyChange}
                    composerDirty={draftHandlers?.composerDirty ?? false}
                    onComposerDirtyChange={draftHandlers?.onComposerDirtyChange}
                  />
                )
              })}
              {virtualWindow.afterHeight > 0 && (
                <div style={{ height: virtualWindow.afterHeight }} aria-hidden />
              )}
            </WorkerPoolContextProvider>
          ) : scrollContentHeight > 0 ? (
            <div style={{ height: scrollContentHeight }} aria-hidden />
          ) : null}
        </div>
      </div>
    </div>
  )
}
