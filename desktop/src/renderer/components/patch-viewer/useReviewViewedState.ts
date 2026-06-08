import { useCallback, useMemo, useState } from 'react'
import type { DiffAnnotation } from '@shared/diff-annotation-types'
import type { DiffFileData } from '../../types/working-tree-diff'
import { getDiffFileReviewLineCount } from './diff-stats'
import { isGithubAnnotation } from './review-threads'

const AUTO_COLLAPSE_FILE_THRESHOLD = 25
const AUTO_COLLAPSE_PATCH_LINE_THRESHOLD = 2000
const AUTO_EXPAND_MIN_FILES = 10
const AUTO_EXPAND_MAX_FILES = 15
const AUTO_EXPAND_PATCH_LINE_BUDGET = 1500

export interface TourStep {
  id: string
  annotation: DiffAnnotation
}

export interface ReviewViewedState {
  collapsedPaths: ReadonlySet<string>
  defaultCollapsedPaths: ReadonlySet<string>
  autoCollapseActive: boolean
  toggleCollapsed: (filePath: string, collapsed: boolean) => void
  viewedFilePaths: Set<string>
  toggleViewed: (filePath: string, viewed: boolean) => void
  showFullContextOverrides: Map<string, boolean>
  toggleShowFullContext: (filePath: string, next: boolean) => void
  // Tour (drawer-only).
  reviewMode: 'annotations' | 'tour'
  setReviewMode: (mode: 'annotations' | 'tour') => void
  tourSteps: TourStep[]
  activeTourStepId: string | null
  activeTourStep: TourStep | null
  selectTourStep: (id: string) => void
  advanceTour: (delta: number) => void
}

/**
 * Collapse / auto-collapse → `item.collapsed`, plus viewed toggles, "show full
 * file" overrides, and drawer tour mode. Auto-collapse budget is unchanged from
 * the retired DiffViewer; it now maps onto CodeView's native per-item collapse
 * instead of dropping items from a hand-rolled window.
 */
export function useReviewViewedState(opts: {
  files: readonly DiffFileData[]
  autoCollapseEnabled: boolean
  annotations: readonly DiffAnnotation[]
  enableViewed: boolean
}): ReviewViewedState {
  const { files, autoCollapseEnabled, annotations } = opts

  const [collapsedOverrides, setCollapsedOverrides] = useState<Map<string, boolean>>(() => new Map())
  const [viewedFilePaths, setViewedFilePaths] = useState<Set<string>>(() => new Set())
  const [showFullContextOverrides, setShowFullContextOverrides] = useState<Map<string, boolean>>(() => new Map())
  const [reviewMode, setReviewMode] = useState<'annotations' | 'tour'>('annotations')
  const [activeTourStepId, setActiveTourStepId] = useState<string | null>(null)

  const totalPatchLineCount = useMemo(
    () => files.reduce((sum, file) => sum + getDiffFileReviewLineCount(file), 0),
    [files],
  )

  const autoCollapseActive =
    autoCollapseEnabled &&
    (files.length >= AUTO_COLLAPSE_FILE_THRESHOLD || totalPatchLineCount >= AUTO_COLLAPSE_PATCH_LINE_THRESHOLD)

  const defaultCollapsedPaths = useMemo(() => {
    const collapsed = new Set<string>()
    if (!autoCollapseActive) return collapsed
    let expandedPatchLines = 0
    files.forEach((file, index) => {
      const patchLineCount = getDiffFileReviewLineCount(file)
      const shouldExpand =
        index < AUTO_EXPAND_MIN_FILES ||
        (index < AUTO_EXPAND_MAX_FILES && expandedPatchLines + patchLineCount <= AUTO_EXPAND_PATCH_LINE_BUDGET)
      if (shouldExpand) expandedPatchLines += patchLineCount
      else collapsed.add(file.filePath)
    })
    return collapsed
  }, [autoCollapseActive, files])

  const collapsedPaths = useMemo(() => {
    const collapsed = new Set(defaultCollapsedPaths)
    for (const [filePath, isCollapsed] of collapsedOverrides) {
      if (isCollapsed) collapsed.add(filePath)
      else collapsed.delete(filePath)
    }
    for (const filePath of viewedFilePaths) collapsed.add(filePath)
    return collapsed
  }, [collapsedOverrides, defaultCollapsedPaths, viewedFilePaths])

  const toggleCollapsed = useCallback(
    (filePath: string, collapsed: boolean) => {
      // Expanding a viewed file also un-views it (matches the retired surface).
      if (!collapsed && viewedFilePaths.has(filePath)) {
        setViewedFilePaths((prev) => {
          const next = new Set(prev)
          next.delete(filePath)
          return next
        })
      }
      setCollapsedOverrides((prev) => {
        const defaultCollapsed = defaultCollapsedPaths.has(filePath)
        const existing = prev.get(filePath)
        if (existing === collapsed) return prev
        const next = new Map(prev)
        if (collapsed === defaultCollapsed) next.delete(filePath)
        else next.set(filePath, collapsed)
        return next
      })
    },
    [defaultCollapsedPaths, viewedFilePaths],
  )

  const toggleViewed = useCallback((filePath: string, viewed: boolean) => {
    setViewedFilePaths((prev) => {
      const next = new Set(prev)
      if (viewed) next.add(filePath)
      else next.delete(filePath)
      return next
    })
    setCollapsedOverrides((prev) => {
      const existing = prev.get(filePath)
      if (existing === viewed) return prev
      const next = new Map(prev)
      next.set(filePath, viewed)
      return next
    })
  }, [])

  const toggleShowFullContext = useCallback((filePath: string, next: boolean) => {
    setShowFullContextOverrides((prev) => {
      const map = new Map(prev)
      map.set(filePath, next)
      return map
    })
  }, [])

  const tourSteps = useMemo<TourStep[]>(() => {
    return annotations
      .filter((a) => a.author && !isGithubAnnotation(a))
      .slice()
      .sort((a, b) =>
        a.filePath.localeCompare(b.filePath) ||
        a.lineNumber - b.lineNumber ||
        a.createdAt.localeCompare(b.createdAt),
      )
      .map((annotation) => ({ id: annotation.id, annotation }))
  }, [annotations])

  const activeTourStep = useMemo(
    () => tourSteps.find((step) => step.id === activeTourStepId) ?? null,
    [tourSteps, activeTourStepId],
  )

  const selectTourStep = useCallback((id: string) => setActiveTourStepId(id), [])

  const advanceTour = useCallback(
    (delta: number) => {
      setActiveTourStepId((current) => {
        if (tourSteps.length === 0) return null
        const index = tourSteps.findIndex((step) => step.id === current)
        const nextIndex = index < 0 ? 0 : Math.min(tourSteps.length - 1, Math.max(0, index + delta))
        return tourSteps[nextIndex]?.id ?? null
      })
    },
    [tourSteps],
  )

  return {
    collapsedPaths,
    defaultCollapsedPaths,
    autoCollapseActive,
    toggleCollapsed,
    viewedFilePaths,
    toggleViewed,
    showFullContextOverrides,
    toggleShowFullContext,
    reviewMode,
    setReviewMode,
    tourSteps,
    activeTourStepId,
    activeTourStep,
    selectTourStep,
    advanceTour,
  }
}
