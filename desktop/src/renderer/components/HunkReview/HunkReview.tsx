import { useEffect, useState, useCallback, useRef, useMemo, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { DiffAnnotation } from '@shared/diff-annotation-types'
import type { GitHunkActionRequest } from '@shared/git-hunk-action-types'
import { useAppStore } from '../../store/app-store'
import { useFileWatcher } from '../../hooks/useFileWatcher'
import { isMarkdownDocumentPath } from '../../utils/markdown-path'
import type { DiffFileData } from '../../types/working-tree-diff'
import { DiffFileSection, FileStrip } from '../Editor/DiffFileSection'
import { loadWorkingTreeExpandableDiffMetadata } from '../Editor/buildWorkingTreeDiffFileData'
import { loadWorkingTreeDiffFiles } from '../Editor/loadWorkingTreeDiffFiles'
import { AnnotationsSummary } from './AnnotationsSummary'
import { TourRail } from './TourRail'
import { resolveAnnotationPathForDiff } from '../../utils/annotation-diff-path'
import { getPreferredScrollBehavior } from '../../utils/preferred-scroll-behavior'
import { measureAsync } from '../../utils/perf'
import styles from './HunkReview.module.css'

const MIN_PANEL_WIDTH = 480
const FALLBACK_VIEWPORT_WIDTH = 1440
const INITIAL_VISIBLE_FILES = 20
const VISIBLE_FILE_CHUNK = 20
const FILE_DIFF_LOAD_CONCURRENCY = 2

interface Props {
  worktreePath: string
}

type ReviewMode = 'annotations' | 'tour'

interface TourStep {
  id: string
  annotation: DiffAnnotation
}

function isGithubAnnotation(annotation: DiffAnnotation) {
  return annotation.id.startsWith('PRR') || annotation.id.startsWith('IC_')
}

function reviewToDiffAnnotations(
  rows: Awaited<ReturnType<typeof window.api.review.commentList>>,
): DiffAnnotation[] {
  return rows.map((r) => ({
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
}

function getViewportWidth() {
  return typeof window === 'undefined' ? FALLBACK_VIEWPORT_WIDTH : window.innerWidth
}

function getDefaultPanelWidth(viewportWidth = getViewportWidth()) {
  return Math.min(viewportWidth, 900, Math.round(viewportWidth * 0.65))
}

function clampPanelWidth(width: number, viewportWidth = getViewportWidth()) {
  const minWidth = Math.min(MIN_PANEL_WIDTH, viewportWidth)
  return Math.max(minWidth, Math.min(width, viewportWidth))
}

export function HunkReview({ worktreePath }: Props) {
  const [files, setFiles] = useState<DiffFileData[]>([])
  const [loading, setLoading] = useState(true)
  const [annotations, setAnnotations] = useState<DiffAnnotation[]>([])
  const [reviewMode, setReviewMode] = useState<ReviewMode>('annotations')
  const [activeTourStepId, setActiveTourStepId] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_FILES)
  const [draftWidth, setDraftWidth] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const draftWidthRef = useRef<number | null>(null)
  const loadGenerationRef = useRef(0)
  const filesRef = useRef<DiffFileData[]>([])
  const fileDiffQueueRef = useRef<string[]>([])
  const fileDiffLoadingRef = useRef(new Set<string>())
  const fileDiffLoadedRef = useRef(new Set<string>())
  const fileDiffInFlightRef = useRef(0)
  const skippedWatcherRefreshesRef = useRef(0)

  const inline = useAppStore((s) => s.settings.diffInline)
  const defaultShowFullContext = useAppStore((s) => s.settings.diffShowFullContextByDefault)
  const persistedWidth = useAppStore((s) => s.settings.hunkReviewWidthPx ?? getDefaultPanelWidth())
  const updateSettings = useAppStore((s) => s.updateSettings)
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const closeHunkReview = useAppStore((s) => s.closeHunkReview)
  const submitHunkReview = useAppStore((s) => s.submitHunkReview)
  const addToast = useAppStore((s) => s.addToast)
  const panelWidth = clampPanelWidth(draftWidth ?? persistedWidth)

  useEffect(() => {
    filesRef.current = files
    for (const file of files) {
      if (file.fileDiff) fileDiffLoadedRef.current.add(file.filePath)
    }
  }, [files])

  // ── Comment selection state ──

  const humanAnnotations = useMemo(
    () => annotations.filter((a) => !a.author),
    [annotations],
  )

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const tourSteps = useMemo(
    () => annotations
      .filter((a) => a.author && !isGithubAnnotation(a))
      .sort((a, b) => {
        if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath)
        if (a.lineNumber !== b.lineNumber) return a.lineNumber - b.lineNumber
        return a.createdAt.localeCompare(b.createdAt)
      })
      .map((annotation) => ({ id: annotation.id, annotation })),
    [annotations],
  )

  const activeTourIndex = useMemo(
    () => tourSteps.findIndex((step) => step.id === activeTourStepId),
    [tourSteps, activeTourStepId],
  )
  const activeTourStep = activeTourIndex >= 0 ? tourSteps[activeTourIndex] : null

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

  const renderedFiles = useMemo(
    () => files.slice(0, visibleCount),
    [files, visibleCount],
  )

  /**
   * Track the set of file paths already mounted so the stagger animation only applies
   * to files that newly appear when `visibleCount` grows (or the first batch).
   */
  const seenFilePathsRef = useRef<Set<string>>(new Set())
  const newlyVisibleFiles = useMemo(() => {
    const map = new Map<string, number>()
    let ordinal = 0
    for (const file of renderedFiles) {
      if (!seenFilePathsRef.current.has(file.filePath)) {
        map.set(file.filePath, ordinal)
        ordinal += 1
      }
    }
    return map
  }, [renderedFiles])

  useEffect(() => {
    for (const file of renderedFiles) {
      seenFilePathsRef.current.add(file.filePath)
    }
  }, [renderedFiles])

  const ensureFileVisible = useCallback((filePath: string) => {
    const index = fileIndexByPath.get(filePath)
    if (index == null) return
    setVisibleCount((prev) => Math.min(files.length, Math.max(prev, index + 1)))
  }, [fileIndexByPath, files.length])

  const scrollToFile = useCallback((filePath: string) => {
    ensureFileVisible(filePath)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(`diff-${filePath}`)
        el?.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: 'start' })
      })
    })
  }, [ensureFileVisible])

  // Auto-select all human comments when annotations load/change
  useEffect(() => {
    setSelectedIds(new Set(humanAnnotations.map((a) => a.id)))
  }, [humanAnnotations])

  useEffect(() => {
    if (reviewMode !== 'tour') return
    if (tourSteps.length === 0) {
      setActiveTourStepId(null)
      return
    }
    if (!activeTourStepId || !tourSteps.some((step) => step.id === activeTourStepId)) {
      setActiveTourStepId(tourSteps[0]!.id)
    }
  }, [reviewMode, tourSteps, activeTourStepId])

  const toggleComment = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allSelected = humanAnnotations.length > 0 && humanAnnotations.every((a) => selectedIds.has(a.id))

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(humanAnnotations.map((a) => a.id)))
    }
  }, [allSelected, humanAnnotations])

  const selectedCount = selectedIds.size

  const handleSelectTourStep = useCallback((stepId: string) => {
    setActiveTourStepId(stepId)
  }, [])

  const handleAdvanceTour = useCallback((direction: -1 | 1) => {
    if (tourSteps.length === 0) return
    const baseIndex = activeTourIndex >= 0 ? activeTourIndex : 0
    const nextIndex = Math.max(0, Math.min(tourSteps.length - 1, baseIndex + direction))
    setActiveTourStepId(tourSteps[nextIndex]!.id)
  }, [tourSteps, activeTourIndex])

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    setDraftWidth(null)
    draftWidthRef.current = null
  }, [persistedWidth, worktreePath])

  useEffect(() => {
    if (!isResizing) return

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current
      if (!dragState) return
      const nextWidth = clampPanelWidth(dragState.startWidth + (dragState.startX - event.clientX))
      draftWidthRef.current = nextWidth
      setDraftWidth(nextWidth)
    }

    const finishResize = () => {
      const nextWidth = draftWidthRef.current ?? persistedWidth
      dragStateRef.current = null
      draftWidthRef.current = null
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setDraftWidth(null)
      if (nextWidth !== persistedWidth) {
        updateSettings({ hunkReviewWidthPx: nextWidth })
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      dragStateRef.current = null
      draftWidthRef.current = null
    }
  }, [isResizing, persistedWidth, updateSettings])

  useEffect(() => {
    const handleResize = () => {
      if (draftWidth !== null) {
        const clamped = clampPanelWidth(draftWidth)
        draftWidthRef.current = clamped
        setDraftWidth(clamped)
        return
      }
      if (persistedWidth == null) return
      const clamped = clampPanelWidth(persistedWidth)
      if (clamped !== persistedWidth) {
        updateSettings({ hunkReviewWidthPx: clamped })
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [draftWidth, persistedWidth, updateSettings])

  const openFileFromDiff = useCallback(
    (fullPath: string) => {
      if (isMarkdownDocumentPath(fullPath)) openMarkdownPreview(fullPath)
      else openFileTab(fullPath)
    },
    [openFileTab, openMarkdownPreview],
  )

  // ── Annotations (libSQL-backed) ──

  const loadAnnotations = useCallback(async () => {
    try {
      const rows = await window.api.review.commentList(worktreePath)
      setAnnotations(reviewToDiffAnnotations(rows))
    } catch (err) {
      console.error('Failed to load review annotations:', err)
      setAnnotations([])
    }
  }, [worktreePath])

  useEffect(() => {
    void loadAnnotations()
  }, [loadAnnotations])

  // Reload when annotations are cleared (e.g. after PR merge)
  useEffect(() => {
    return window.api.review.onAnnotationsCleared(() => {
      void loadAnnotations()
    })
  }, [loadAnnotations])

  // ── GitHub PR comment loading ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const branch = await window.api.git.getCurrentBranch(worktreePath)
        if (!branch || cancelled) return

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
  }, [worktreePath])

  const notifyGitFilesChanged = useCallback((paths: string[]) => {
    window.dispatchEvent(new CustomEvent('git:files-changed', {
      detail: { worktreePath, paths },
    }))
  }, [worktreePath])

  // ── Load working-tree diff ──

  const loadFiles = useCallback(async () => {
    const generation = ++loadGenerationRef.current
    try {
      const results = await loadWorkingTreeDiffFiles({
        worktreePath,
        source: 'hunk-review',
        isCancelled: () => loadGenerationRef.current !== generation,
        onProgress: (nextFiles) => {
          if (loadGenerationRef.current !== generation) return
          setFiles(nextFiles)
        },
      })
      if (loadGenerationRef.current !== generation) return
      setFiles(results)
    } catch (err) {
      console.error('Failed to load diffs:', err)
    } finally {
      if (loadGenerationRef.current === generation) {
        setLoading(false)
      }
    }
  }, [worktreePath])

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
          id: `review-hunk-${request.action}-err-${Date.now()}`,
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
    setVisibleCount(INITIAL_VISIBLE_FILES)
    setLoading(true)
    void loadFiles()
  }, [loadFiles])

  useFileWatcher(worktreePath, handleWatchedDirChange, true)

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
      void measureAsync('hunk-review:load-expandable-file', () => loadWorkingTreeExpandableDiffMetadata(worktreePath, file), {
        worktreePath,
        filePath,
      }).then((fileDiff) => {
        if (!fileDiff) return
        if (loadGenerationRef.current !== generation) return
        fileDiffLoadedRef.current.add(filePath)
        setFiles((prev) => prev.map((entry) => (
          entry.filePath === filePath && !entry.fileDiff
            ? { ...entry, fileDiff }
            : entry
        )))
      }).catch((error) => {
        console.warn('Failed to load expandable diff metadata for review:', error)
      }).finally(() => {
        fileDiffLoadingRef.current.delete(filePath)
        fileDiffInFlightRef.current -= 1
        pumpFileDiffQueue()
      })
    }
  }, [worktreePath])

  const ensureFileDiffLoaded = useCallback((filePath: string) => {
    const file = filesRef.current.find((entry) => entry.filePath === filePath)
    if (!file || file.fileDiff || !file.patch) return
    if (fileDiffLoadedRef.current.has(filePath) || fileDiffLoadingRef.current.has(filePath)) return
    if (fileDiffQueueRef.current.includes(filePath)) return
    fileDiffQueueRef.current.push(filePath)
    pumpFileDiffQueue()
  }, [pumpFileDiffQueue])

  const scrollToAnnotationInDiff = useCallback(
    (annotation: DiffAnnotation) => {
      const resolved = resolveAnnotationPathForDiff(
        annotation.filePath,
        files.map((f) => f.filePath),
      )
      if (!resolved) {
        addToast({
          id: `ann-jump-${Date.now()}`,
          message: `File not in current diff: ${annotation.filePath}`,
          type: 'warning',
        })
        return
      }
      ensureFileVisible(resolved)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const fileEl = document.getElementById(`diff-${resolved}`)
          const bubble = document.querySelector(`[data-annotation-id="${annotation.id}"]`)
          const target = (bubble ?? fileEl) as HTMLElement | null
          if (!target) {
            addToast({
              id: `ann-jump-${Date.now()}`,
              message: 'Could not find annotation in diff view',
              type: 'warning',
            })
            return
          }
          const root = scrollAreaRef.current
          if (root) {
            const rootRect = root.getBoundingClientRect()
            const elRect = target.getBoundingClientRect()
            const top = elRect.top - rootRect.top + root.scrollTop
            root.scrollTo({ top: Math.max(0, top - 12), behavior: getPreferredScrollBehavior() })
          } else {
            target.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: 'nearest' })
          }
          requestAnimationFrame(() => {
            const b = document.querySelector(`[data-annotation-id="${annotation.id}"]`)
            if (b) {
              b.classList.add('highlightFlash')
              setTimeout(() => b.classList.remove('highlightFlash'), 1200)
            } else if (fileEl) {
              fileEl.classList.add('highlightFlash')
              setTimeout(() => fileEl.classList.remove('highlightFlash'), 1200)
            }
          })
        })
      })
    },
    [files, addToast, ensureFileVisible],
  )

  useEffect(() => {
    if (reviewMode !== 'tour' || !activeTourStep) return
    scrollToAnnotationInDiff(activeTourStep.annotation)
  }, [reviewMode, activeTourStep, scrollToAnnotationInDiff])

  // IntersectionObserver to highlight active file in strip
  useEffect(() => {
    if (!scrollAreaRef.current || renderedFiles.length === 0) return

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
      { root: scrollAreaRef.current, threshold: 0.3 },
    )

    for (const f of renderedFiles) {
      const el = document.getElementById(`diff-${f.filePath}`)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [renderedFiles])

  useEffect(() => {
    const root = scrollAreaRef.current
    if (!root) return
    const onScroll = () => {
      const remaining = root.scrollHeight - root.scrollTop - root.clientHeight
      if (remaining < 800) {
        setVisibleCount((prev) => Math.min(files.length, prev + VISIBLE_FILE_CHUNK))
      }
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => root.removeEventListener('scroll', onScroll)
  }, [files.length, renderedFiles.length])

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragStateRef.current = { startX: event.clientX, startWidth: panelWidth }
    draftWidthRef.current = panelWidth
    setDraftWidth(panelWidth)
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [panelWidth])

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Close review panel"
        onClick={closeHunkReview}
      />

      {/* Panel */}
      <div
        className={styles.panel}
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Review Changes"
        data-testid="hunk-review-panel"
        style={{ width: panelWidth }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            closeHunkReview()
          }
        }}
      >
        <button
          type="button"
          className={`${styles.resizeHandle} ${isResizing ? styles.resizeHandleActive : ''}`}
          aria-label="Resize review panel"
          data-testid="hunk-review-resize-handle"
          onPointerDown={handleResizeStart}
        >
          <span className={styles.resizeGrip} aria-hidden="true" />
        </button>
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.title}>Review Changes</span>
          {files.length > 0 && (
            <span className={styles.badge}>
              {files.length} file{files.length !== 1 ? 's' : ''}
            </span>
          )}
          {reviewMode === 'annotations' && humanAnnotations.length > 0 && (
            <button className={styles.selectAllBtn} onClick={toggleAll}>
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
          )}
          <div className={styles.headerSpacer} />
          <div className={styles.toggleGroup}>
            <button
              className={`${styles.toggleOption} ${reviewMode === 'annotations' ? styles.active : ''}`}
              onClick={() => setReviewMode('annotations')}
            >
              Annotations
            </button>
            <button
              className={`${styles.toggleOption} ${reviewMode === 'tour' ? styles.active : ''}`}
              onClick={() => setReviewMode('tour')}
            >
              Code Tour
            </button>
          </div>
          <div className={styles.toggleGroup}>
            <button
              className={`${styles.toggleOption} ${!inline ? styles.active : ''}`}
              onClick={() => updateSettings({ diffInline: false })}
            >
              Split
            </button>
            <button
              className={`${styles.toggleOption} ${inline ? styles.active : ''}`}
              onClick={() => updateSettings({ diffInline: true })}
            >
              Inline
            </button>
          </div>
          {reviewMode === 'annotations' && (
            <button
              className={styles.submitBtn}
              disabled={selectedCount === 0}
              onClick={() => void submitHunkReview(selectedIds)}
            >
              Submit Review{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </button>
          )}
          <button className={styles.closeBtn} onClick={closeHunkReview}>
            &times;
          </button>
        </div>

        {/* Hint */}
        <p className={styles.hint}>
          {reviewMode === 'tour'
            ? 'Walk the key agent-authored changes step by step. Click any step to sync the diff with the tour.'
            : 'Hover a line and click + to comment, or drag across line numbers for a range. Submit sends selected comments to the agent.'}
        </p>

        {/* File strip */}
        {files.length > 0 && <FileStrip files={files} activeFile={activeFile} onSelectFile={scrollToFile} />}

        {/* Annotations summary from constell-annotate SQLite DB */}
        {reviewMode === 'tour' ? (
          <TourRail
            steps={tourSteps}
            activeStepId={activeTourStepId}
            onSelectStep={handleSelectTourStep}
            onPrevious={() => handleAdvanceTour(-1)}
            onNext={() => handleAdvanceTour(1)}
          />
        ) : (
          <AnnotationsSummary
            annotations={annotations}
            worktreePath={worktreePath}
            onAnnotationsChanged={loadAnnotations}
            selectedIds={selectedIds}
            onToggleComment={toggleComment}
            onJumpToAnnotation={scrollToAnnotationInDiff}
          />
        )}

        {/* Content */}
        {loading && files.length === 0 ? (
          <div className={styles.emptyState} role="status" aria-busy="true" aria-label="Loading changes">
            <div className="shimmer-block" style={{ width: 'min(200px, 70%)', height: 14, marginBottom: 10 }} />
            <div className="shimmer-block" style={{ width: 'min(260px, 85%)', height: 14 }} />
          </div>
        ) : files.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>&#10003;</span>
            <span className={styles.emptyText}>No changes</span>
          </div>
        ) : (
          <div ref={scrollAreaRef} className={styles.scrollArea}>
            {loading && (
              <div className={styles.emptyState} role="status" aria-busy="true" aria-label="Loading more changes">
                <span className={styles.emptyText}>Loading remaining changes...</span>
              </div>
            )}
            {renderedFiles.map((f) => {
              const newIndex = newlyVisibleFiles.get(f.filePath)
              const isNew = newIndex != null
              return (
                <div
                  key={f.filePath}
                  className={isNew ? styles.diffFileStaggerEntry : undefined}
                  style={isNew ? ({ '--stagger-index': String(Math.min(newIndex, 8)) } as CSSProperties) : undefined}
                >
                  <DiffFileSection
                    data={f}
                    inline={inline}
                    defaultShowFullContext={defaultShowFullContext}
                    worktreePath={worktreePath}
                    onOpenFile={openFileFromDiff}
                    fileAnnotations={annotationsByFile.get(f.filePath) ?? []}
                    onAnnotationsChanged={loadAnnotations}
                    showPatchAnchorNote={false}
                    activeTourAnnotationId={reviewMode === 'tour' ? (activeTourStepId ?? undefined) : undefined}
                    tourMode={reviewMode === 'tour'}
                    selectedCommentIds={selectedIds}
                    onToggleComment={toggleComment}
                    enableAcceptReject
                    onHunkAccepted={applyHunkAction}
                    onHunkRejected={applyHunkAction}
                    onEnsureFileDiff={ensureFileDiffLoaded}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
