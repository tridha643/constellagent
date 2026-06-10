import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { CodeViewHandle } from '@pierre/diffs/react'
import type { DiffAnnotation } from '@shared/diff-annotation-types'
import { useAppStore } from '../../store/app-store'
import { isMarkdownDocumentPath } from '../../utils/markdown-path'
import { getPreferredScrollBehavior } from '../../utils/preferred-scroll-behavior'
import { registerChangesFindSource } from '../../utils/changes-file-find-bridge'
import { FloatingPanel } from '../FloatingPanel/FloatingPanel'
import { TourRail } from '../HunkReview/TourRail'
import { PatchCodeView } from './PatchCodeView'
import { CombinedMergeFallback } from './combined-merge-fallback'
import { buildPatchViewModel } from './patch-view-model'
import { getCodeViewItemId } from './patch-utils'
import { normalizePath } from './review-threads'
import { getDiffReviewSummary } from './diff-stats'
import {
  DIFF_E2E_OPEN_COMMENT_COMPOSER,
  type DiffE2eOpenCommentComposerDetail,
} from '../Editor/diff-comment-draft'
import { usePatchParsing } from './usePatchParsing'
import { useWorkingTreeDiff } from './useWorkingTreeDiff'
import { useReviewThreads } from './useReviewThreads'
import { useHunkActions } from './useHunkActions'
import { useReviewViewedState } from './useReviewViewedState'
import { useReviewSubmission } from './useReviewSubmission'
import { useReviewComposerSession } from './useReviewComposerSession'
import { draftTargetFor } from './line-selection'
import editorStyles from '../Editor/Editor.module.css'
import drawerStyles from '../HunkReview/HunkReview.module.css'

const MIN_PANEL_WIDTH = 480

/** Map the user's reduced-motion scroll preference onto CodeView's behavior set. */
function codeViewScrollBehavior(): 'instant' | 'smooth' {
  return getPreferredScrollBehavior() === 'smooth' ? 'smooth' : 'instant'
}

function getViewportWidth(): number {
  return typeof window !== 'undefined' ? window.innerWidth : 1440
}
function getDefaultPanelWidth(viewportWidth = getViewportWidth()): number {
  return Math.min(viewportWidth, 900, Math.round(viewportWidth * 0.65))
}
function clampPanelWidth(width: number, viewportWidth = getViewportWidth()): number {
  const minWidth = Math.min(MIN_PANEL_WIDTH, viewportWidth)
  return Math.max(minWidth, Math.min(width, viewportWidth))
}

export interface PatchViewerMainProps {
  worktreePath: string
  variant: 'tab' | 'drawer'
  /** Tab variant: whether this is the active diff tab (mount-all). Drawer: always true. */
  active?: boolean
}

/**
 * Single review surface rendered through one `<CodeView>`. Replaces BOTH the
 * retired DiffViewer (`variant: 'tab'`) and HunkReview (`variant: 'drawer'`).
 * Owns data load + state composition; CodeView owns virtualization, scroll
 * anchoring, sticky headers, element pooling, and the highlight worker pool.
 */
export function PatchViewerMain({
  worktreePath,
  variant,
  active = true,
}: PatchViewerMainProps) {
  const isDrawer = variant === 'drawer'

  const inline = useAppStore((s) => s.settings.diffInline)
  const defaultShowFullContext = useAppStore((s) => s.settings.diffShowFullContextByDefault)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const toggleHunkReview = useAppStore((s) => s.toggleHunkReview)
  const closeHunkReview = useAppStore((s) => s.closeHunkReview)
  const hunkReviewOpen = useAppStore((s) => s.hunkReviewOpen)
  const hunkReviewWorkspaceId = useAppStore((s) => s.hunkReviewWorkspaceId)
  const workspaces = useAppStore((s) => s.workspaces)
  const persistedWidth = useAppStore((s) => s.settings.hunkReviewWidthPx ?? getDefaultPanelWidth())
  const hasAgentPty = useAppStore((s) => {
    const ws = s.workspaces.find((w) => w.worktreePath === worktreePath)
    if (!ws) return false
    return s.tabs.some((t) => t.workspaceId === ws.id && t.type === 'terminal' && t.agentType)
  })

  const reviewWorkspace = useMemo(
    () => workspaces.find((w) => w.worktreePath === worktreePath),
    [workspaces, worktreePath],
  )

  // ── Data layers ──
  const workingTree = useWorkingTreeDiff({ worktreePath, active })
  const { files, loading } = workingTree
  const parsed = usePatchParsing(files)
  const review = useReviewThreads({ worktreePath, active })
  const viewedState = useReviewViewedState({
    files,
    autoCollapseEnabled: true,
    annotations: review.annotations,
    enableViewed: isDrawer,
  })
  const hunkActions = useHunkActions({
    worktreePath,
    files,
    markSelfInducedChange: workingTree.markSelfInducedChange,
    notifyGitFilesChanged: workingTree.notifyGitFilesChanged,
  })
  const composer = useReviewComposerSession()
  const submission = useReviewSubmission({ annotations: review.annotations })

  const model = useMemo(
    () =>
      buildPatchViewModel({
        files,
        parsed,
        reviewThreadsByFile: review.reviewThreadsByFile,
        collapsedPaths: viewedState.collapsedPaths,
        showFullContextOverrides: viewedState.showFullContextOverrides,
        defaultShowFullContext,
        // Hunk staging (accept/reject) was removed from the review surface.
        enableAcceptReject: false,
        hiddenHunksByPath: hunkActions.hiddenHunksByPath,
        fileDiffOverrides: hunkActions.fileDiffOverrides,
        draftTarget: composer.draftTarget,
      }),
    [
      files,
      parsed,
      review.reviewThreadsByFile,
      viewedState.collapsedPaths,
      viewedState.showFullContextOverrides,
      defaultShowFullContext,
      hunkActions.hiddenHunksByPath,
      hunkActions.fileDiffOverrides,
      composer.draftTarget,
    ],
  )

  const reviewSummary = useMemo(() => getDiffReviewSummary(files), [files])

  // Preload full metadata for non-collapsed files so the per-file "show full file"
  // re-expansion is ready without a flash. Throttled by the fetch queue.
  useEffect(() => {
    if (!active) return
    for (const file of files) {
      if (file.fileDiff || !file.patch) continue
      if (viewedState.collapsedPaths.has(file.filePath)) continue
      workingTree.ensureFileDiffLoaded(file.filePath)
    }
  }, [active, files, viewedState.collapsedPaths, workingTree])

  // ── Imperative CodeView handle: scroll restore + jump-to-file ──
  const codeViewRef = useRef<CodeViewHandle<DiffAnnotation[]>>(null)
  const savedScrollTopRef = useRef(0)

  const onScroll = useCallback(
    (scrollTop: number) => {
      if (active) savedScrollTopRef.current = scrollTop
    },
    [active],
  )

  // Restore scroll on (re)activation (tab variant). Drawer stays mounted/visible.
  useEffect(() => {
    if (!active) return
    const handle = codeViewRef.current
    if (!handle) return
    const raf = requestAnimationFrame(() => {
      handle.scrollTo({ type: 'position', position: savedScrollTopRef.current })
    })
    return () => cancelAnimationFrame(raf)
  }, [active])

  const jumpToFile = useCallback(
    (filePath: string) => {
      viewedState.toggleCollapsed(filePath, false)
      const itemId = model.byFilePath.get(normalizePath(filePath)) ?? getCodeViewItemId(filePath)
      requestAnimationFrame(() => {
        codeViewRef.current?.scrollTo({
          type: 'item',
          id: itemId,
          align: 'start',
          behavior: codeViewScrollBehavior(),
        })
      })
    },
    [viewedState, model.byFilePath],
  )

  // Jump-to-file from the Changes panel.
  useEffect(() => {
    if (!active) return
    const handler = (e: Event) => jumpToFile((e as CustomEvent<string>).detail)
    window.addEventListener('diff:scrollToFile', handler)
    return () => window.removeEventListener('diff:scrollToFile', handler)
  }, [active, jumpToFile])

  // Playwright seam: open the comment composer at a line (Pierre shadow-DOM
  // affordances aren't reliably clickable in e2e).
  useEffect(() => {
    if (!active) return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<DiffE2eOpenCommentComposerDetail>).detail
      if (!detail?.filePath) return
      const line = detail.lineNumber ?? 1
      composer.openDraft(draftTargetFor(detail.filePath, detail.side ?? 'additions', line, line))
    }
    window.addEventListener(DIFF_E2E_OPEN_COMMENT_COMPOSER, handler)
    return () => window.removeEventListener(DIFF_E2E_OPEN_COMMENT_COMPOSER, handler)
  }, [active, composer])

  useEffect(() => {
    if (!active) return
    return registerChangesFindSource('diff-tab', () => {
      if (files.length === 0) return null
      return { worktreePath, paths: files.map((f) => f.filePath), onPick: jumpToFile }
    })
  }, [active, worktreePath, files, jumpToFile])

  // Tour: sync diff scroll to the active step's annotation.
  useEffect(() => {
    if (!isDrawer || viewedState.reviewMode !== 'tour') return
    const step = viewedState.activeTourStep
    if (!step) return
    const annotation = step.annotation
    const itemId = model.byFilePath.get(normalizePath(annotation.filePath)) ?? getCodeViewItemId(annotation.filePath)
    codeViewRef.current?.scrollTo({
      type: 'line',
      id: itemId,
      lineNumber: annotation.lineNumber,
      side: annotation.side,
      align: 'center',
      behavior: codeViewScrollBehavior(),
    })
  }, [isDrawer, viewedState.reviewMode, viewedState.activeTourStep])

  // ── Callbacks wired into CodeView ──
  const openFileFromDiff = useCallback(
    (fullPath: string) => {
      if (isMarkdownDocumentPath(fullPath)) openMarkdownPreview(fullPath)
      else openFileTab(fullPath)
    },
    [openFileTab, openMarkdownPreview],
  )

  const ensureExpandedForFullContext = useCallback(
    (filePath: string, next: boolean) => {
      if (next) workingTree.ensureFileDiffLoaded(filePath)
      viewedState.toggleShowFullContext(filePath, next)
    },
    [workingTree, viewedState],
  )

  // ── Drawer resize ──
  const shellRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<{ startX: number; startWidth: number; pointerId: number; handle: HTMLButtonElement } | null>(null)
  const draftWidthRef = useRef<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const panelWidth = clampPanelWidth(persistedWidth)

  // Focus the drawer on mount so Escape (and other panel keys) are captured.
  useEffect(() => {
    if (isDrawer) panelRef.current?.focus()
  }, [isDrawer])

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    try { handle.setPointerCapture(event.pointerId) } catch { /* synthetic test pointers */ }
    dragStateRef.current = { startX: event.clientX, startWidth: panelWidth, pointerId: event.pointerId, handle }
    draftWidthRef.current = panelWidth
    if (shellRef.current) shellRef.current.style.width = `${panelWidth}px`
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [panelWidth])

  const handleResizeMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current
    if (!dragState) return
    event.preventDefault()
    const nextWidth = clampPanelWidth(dragState.startWidth + (dragState.startX - event.clientX))
    draftWidthRef.current = nextWidth
    if (shellRef.current) shellRef.current.style.width = `${nextWidth}px`
  }, [])

  const finishResize = useCallback(() => {
    const nextWidth = draftWidthRef.current ?? persistedWidth
    const dragState = dragStateRef.current
    if (dragState?.handle.hasPointerCapture(dragState.pointerId)) {
      try { dragState.handle.releasePointerCapture(dragState.pointerId) } catch { /* already released */ }
    }
    dragStateRef.current = null
    draftWidthRef.current = null
    setIsResizing(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (shellRef.current) shellRef.current.style.width = `${nextWidth}px`
    updateSettings({ hunkReviewWidthPx: nextWidth })
  }, [persistedWidth, updateSettings])

  const openReviewDrawer = useCallback(() => {
    if (hunkReviewOpen && hunkReviewWorkspaceId === reviewWorkspace?.id) return
    if (hunkReviewOpen) {
      closeHunkReview()
      requestAnimationFrame(() => { void toggleHunkReview() })
      return
    }
    void toggleHunkReview()
  }, [closeHunkReview, hunkReviewOpen, hunkReviewWorkspaceId, reviewWorkspace?.id, toggleHunkReview])

  const codeView = (
    <PatchCodeView
      ref={codeViewRef}
      style={{ flex: 1, minHeight: 0 }}
      items={model.items}
      byItemId={model.byItemId}
      inline={inline}
      worktreePath={worktreePath}
      draftTarget={composer.draftTarget}
      composerBody={composer.composerBody}
      onComposerBodyChange={composer.setComposerBody}
      onComposerSeedPristine={composer.markComposerPristine}
      onSelectionChange={composer.onSelectionChange}
      onApplyAnnotation={review.applyAnnotationPatch}
      onOpenFile={openFileFromDiff}
      onToggleCollapsed={viewedState.toggleCollapsed}
      onToggleViewed={isDrawer ? viewedState.toggleViewed : undefined}
      onToggleShowFullContext={ensureExpandedForFullContext}
      onAddToChat={composer.onAddToChat}
      viewedFilePaths={isDrawer ? viewedState.viewedFilePaths : undefined}
      enableViewedToggle={isDrawer}
      tourMode={isDrawer && viewedState.reviewMode === 'tour'}
      activeTourAnnotationId={viewedState.activeTourStepId ?? undefined}
      selectedCommentIds={isDrawer ? submission.selectedIds : undefined}
      onToggleComment={isDrawer ? submission.toggleComment : undefined}
      onScroll={onScroll}
    />
  )

  const combinedMerge = (
    <CombinedMergeFallback
      files={model.combinedMergeFiles}
      worktreePath={worktreePath}
      onOpenFile={openFileFromDiff}
    />
  )

  const isEmpty = !loading && files.length === 0

  // ── Tab variant ──
  if (!isDrawer) {
    const containerClass = active
      ? editorStyles.diffViewerContainer
      : `${editorStyles.diffViewerContainer} ${editorStyles.inactive}`

    // Inactive diff tabs stay mounted-but-hidden (mount-all); CodeView is unmounted
    // while hidden and its scrollTop is restored from savedScrollTopRef on activation.
    if (!active) {
      return <div className={containerClass} style={{ display: 'none' }} aria-hidden />
    }

    if (loading && files.length === 0) {
      return (
        <div className={containerClass}>
          <div className={editorStyles.diffEmpty}>
            <span className={editorStyles.diffEmptyText}>Loading changes...</span>
          </div>
        </div>
      )
    }
    if (isEmpty) {
      return (
        <div className={containerClass}>
          <div className={editorStyles.diffEmpty}>
            <span className={editorStyles.diffEmptyIcon}>&#10003;</span>
            <span className={editorStyles.diffEmptyText}>No changes</span>
          </div>
        </div>
      )
    }

    return (
      <div className={containerClass}>
        <div className={editorStyles.diffToolbar}>
          <div className={editorStyles.diffReviewSummary}>
            <span className={`${editorStyles.diffSummaryPrimary} ${editorStyles.diffFileCount}`}>
              {`${files.length} file${files.length !== 1 ? 's' : ''}`}
            </span>
            <span className={editorStyles.diffSummaryPill}>
              {viewedState.viewedFilePaths.size}/{files.length} viewed
            </span>
            <span className={editorStyles.diffSummaryAdd}>+{reviewSummary.additions}</span>
            <span className={editorStyles.diffSummaryDel}>-{reviewSummary.deletions}</span>
            {loading && files.length > 0 && (
              <span className={editorStyles.diffSummaryMuted}>Loading remaining changes...</span>
            )}
            {viewedState.autoCollapseActive && (
              <span className={editorStyles.diffSummaryMuted}>
                First files expanded, remaining files collapsed for performance
              </span>
            )}
          </div>
          <div className={editorStyles.diffControlsRight}>
            <button type="button" className={editorStyles.diffReviewButton} onClick={openReviewDrawer}>
              Review
            </button>
            <div className={editorStyles.diffToggle}>
              <button
                className={`${editorStyles.diffToggleOption} ${!inline ? editorStyles.active : ''}`}
                onClick={() => updateSettings({ diffInline: false })}
              >
                Side by side
              </button>
              <button
                className={`${editorStyles.diffToggleOption} ${inline ? editorStyles.active : ''}`}
                onClick={() => updateSettings({ diffInline: true })}
              >
                Inline
              </button>
            </div>
          </div>
        </div>

        <p className={editorStyles.diffCommentHint}>
          Hover a line and click + to comment, or drag across the code or line numbers for a range.
        </p>

        <div className={editorStyles.fileStrip}>
          {files.map((f) => {
            const viewed = viewedState.viewedFilePaths.has(f.filePath)
            return (
              <button
                key={f.filePath}
                type="button"
                className={`${editorStyles.fileStripItem} ${viewed ? editorStyles.fileStripItemViewed : ''}`}
                onClick={() => jumpToFile(f.filePath)}
              >
                {f.filePath.split('/').pop()}
              </button>
            )
          })}
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {codeView}
          {model.combinedMergeFiles.length > 0 && (
            <div style={{ maxHeight: '40%', overflow: 'auto', flex: 'none' }}>{combinedMerge}</div>
          )}
        </div>
      </div>
    )
  }

  // ── Drawer variant ──
  return (
    <>
      <button
        type="button"
        className={`${drawerStyles.backdrop} ${isResizing ? drawerStyles.backdropResizing : ''}`}
        aria-label="Close review panel"
        onClick={closeHunkReview}
      />
      <FloatingPanel
        variant="drawer"
        testId="hunk-review-panel"
        shellClassName={drawerStyles.drawerShell}
        cardClassName={drawerStyles.drawerCard}
        shellStyle={{ width: panelWidth }}
        shellRef={shellRef}
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Review Changes"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            closeHunkReview()
          }
        }}
      >
        <button
          type="button"
          className={`${drawerStyles.resizeHandle} ${isResizing ? drawerStyles.resizeHandleActive : ''}`}
          aria-label="Resize review panel"
          data-testid="hunk-review-resize-handle"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
        >
          <span className={drawerStyles.resizeGrip} aria-hidden="true" />
        </button>

        <div className={drawerStyles.header}>
          <span className={drawerStyles.title}>Review Changes</span>
          {files.length > 0 && (
            <span className={drawerStyles.badge}>
              {files.length} file{files.length !== 1 ? 's' : ''}
            </span>
          )}
          <div className={drawerStyles.headerSpacer} />
          <div className={drawerStyles.toggleGroup}>
            <button
              className={`${drawerStyles.toggleOption} ${viewedState.reviewMode === 'annotations' ? drawerStyles.active : ''}`}
              onClick={() => viewedState.setReviewMode('annotations')}
            >
              Annotations
            </button>
            <button
              className={`${drawerStyles.toggleOption} ${viewedState.reviewMode === 'tour' ? drawerStyles.active : ''}`}
              onClick={() => viewedState.setReviewMode('tour')}
            >
              Code Tour
            </button>
          </div>
          <div className={drawerStyles.toggleGroup}>
            <button
              className={`${drawerStyles.toggleOption} ${!inline ? drawerStyles.active : ''}`}
              onClick={() => updateSettings({ diffInline: false })}
            >
              Split
            </button>
            <button
              className={`${drawerStyles.toggleOption} ${inline ? drawerStyles.active : ''}`}
              onClick={() => updateSettings({ diffInline: true })}
            >
              Inline
            </button>
          </div>
          {viewedState.reviewMode === 'annotations' && (
            <button
              className={drawerStyles.submitBtn}
              disabled={submission.selectedCount === 0}
              onClick={submission.submit}
            >
              Submit Review{submission.selectedCount > 0 ? ` (${submission.selectedCount})` : ''}
            </button>
          )}
          <button className={drawerStyles.closeBtn} onClick={closeHunkReview}>
            &times;
          </button>
        </div>

        <p className={drawerStyles.hint}>
          {viewedState.reviewMode === 'tour'
            ? 'Walk the key agent-authored changes step by step. Click any step to sync the diff with the tour.'
            : hasAgentPty
              ? 'Hover a line and click + to comment, or drag across line numbers for a range. Submit sends selected comments to the agent.'
              : 'Hover a line and click + to comment, or drag across line numbers for a range. Start an agent terminal before submitting selected comments.'}
        </p>

        {viewedState.reviewMode === 'tour' && (
          <TourRail
            steps={viewedState.tourSteps}
            activeStepId={viewedState.activeTourStepId}
            onSelectStep={viewedState.selectTourStep}
            onPrevious={() => viewedState.advanceTour(-1)}
            onNext={() => viewedState.advanceTour(1)}
          />
        )}

        {loading && files.length === 0 ? (
          <div className={drawerStyles.emptyState} role="status" aria-busy="true" aria-label="Loading changes">
            <div className="shimmer-block" style={{ width: 'min(200px, 70%)', height: 14, marginBottom: 10 }} />
            <div className="shimmer-block" style={{ width: 'min(260px, 85%)', height: 14 }} />
          </div>
        ) : files.length === 0 ? (
          <div className={drawerStyles.emptyState}>
            <span className={drawerStyles.emptyIcon}>&#10003;</span>
            <span className={drawerStyles.emptyText}>No changes</span>
          </div>
        ) : (
          <div
            className={drawerStyles.scrollArea}
            data-testid="hunk-review-scroll-area"
            style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            {loading && (
              <div className={drawerStyles.emptyState} role="status" aria-busy="true" aria-label="Loading more changes">
                <span className={drawerStyles.emptyText}>Loading remaining changes...</span>
              </div>
            )}
            {codeView}
            {model.combinedMergeFiles.length > 0 && (
              <div style={{ maxHeight: '40%', overflow: 'auto', flex: 'none' }}>{combinedMerge}</div>
            )}
          </div>
        )}
      </FloatingPanel>
    </>
  )
}
