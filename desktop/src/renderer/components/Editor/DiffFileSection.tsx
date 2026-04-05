import { useState, useCallback, memo, useMemo, useEffect } from 'react'
import {
  PatchDiff,
  FileDiff,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type RenderHeaderMetadataProps,
} from '@pierre/diffs/react'
import { getSingularPatch, diffAcceptRejectHunk } from '@pierre/diffs'
import type { DiffAnnotation, DiffAnnotationSide } from '@shared/diff-annotation-types'
import { STATUS_LABELS } from '../../../shared/status-labels'
import { ErrorBoundary } from '../ErrorBoundary/ErrorBoundary'
import { AnnotationBubble, AnnotationComposer } from './AnnotationBubble'
import annotationUi from './AnnotationBubble.module.css'
import styles from './Editor.module.css'

const DIFFS_THEME = 'pierre-dark' as const

/** Pierre LineSelectionManager payload (not re-exported from `@pierre/diffs/react`). */
export interface PierreSelectedRange {
  start: number
  end: number
  side?: DiffAnnotationSide
  endSide?: DiffAnnotationSide
}

export interface DiffFileData {
  filePath: string
  patch: string
  status: string
}

export function normalizeDiffSelection(range: PierreSelectedRange): {
  side: DiffAnnotationSide
  lineNumber: number
  lineEnd: number
} {
  const side = (range.side ?? 'additions') as DiffAnnotationSide
  if (range.endSide != null && range.endSide !== side) {
    return { side, lineNumber: range.start, lineEnd: range.start }
  }
  const lo = Math.min(range.start, range.end)
  const hi = Math.max(range.start, range.end)
  return { side, lineNumber: lo, lineEnd: hi }
}

/**
 * Merge commits use combined diffs (`diff --cc`, `@@@` hunks). @pierre/diffs only supports
 * unified `diff --git` / `@@` patches — see its GIT_DIFF_FILE_BREAK_REGEX / FILE_CONTEXT_BLOB.
 */
export function isCombinedMergePatch(patch: string): boolean {
  return /^diff --cc /m.test(patch) || /^@@@ /m.test(patch)
}

// ── Per-file diff section ──

export interface DiffFileSectionProps {
  data: DiffFileData
  inline: boolean
  worktreePath: string
  onOpenFile: (filePath: string) => void
  worktreeAnnotations: DiffAnnotation[]
  onAnnotationsChanged: () => void
  showPatchAnchorNote: boolean
  selectedCommentIds?: Set<string>
  onToggleComment?: (id: string) => void
  enableAcceptReject?: boolean
  onHunkAccepted?: (filePath: string, hunkIndex: number) => void
  onHunkRejected?: (filePath: string, hunkIndex: number) => void
}

export const DiffFileSection = memo(function DiffFileSection({
  data,
  inline,
  worktreePath,
  onOpenFile,
  worktreeAnnotations,
  onAnnotationsChanged,
  showPatchAnchorNote,
  selectedCommentIds,
  onToggleComment,
  enableAcceptReject,
  onHunkAccepted,
  onHunkRejected,
}: DiffFileSectionProps) {
  const [selectedLines, setSelectedLines] = useState<PierreSelectedRange | null>(null)
  const [pendingRange, setPendingRange] = useState<{
    side: DiffAnnotationSide
    lineNumber: number
    lineEnd: number
  } | null>(null)

  const [fileDiffState, setFileDiffState] = useState<FileDiffMetadata | null>(null)

  useEffect(() => {
    if (!data.patch || isCombinedMergePatch(data.patch)) {
      setFileDiffState(null)
      return
    }
    try {
      setFileDiffState(getSingularPatch(data.patch))
    } catch {
      setFileDiffState(null)
    }
  }, [data.patch])

  const parts = data.filePath.split('/')
  const fileName = parts.pop()
  const dir = parts.length > 0 ? parts.join('/') + '/' : ''

  const fullPath = data.filePath.startsWith('/')
    ? data.filePath
    : `${worktreePath}/${data.filePath}`

  const fileAnnotations = useMemo(
    () => worktreeAnnotations.filter((a) => a.filePath === data.filePath),
    [worktreeAnnotations, data.filePath],
  )

  const lineAnnotations = useMemo((): DiffLineAnnotation<DiffAnnotation[]>[] => {
    const map = new Map<string, DiffAnnotation[]>()
    for (const a of fileAnnotations) {
      const key = `${a.side}:${a.lineNumber}`
      let arr = map.get(key)
      if (!arr) {
        arr = []
        map.set(key, arr)
      }
      arr.push(a)
    }
    for (const arr of map.values()) {
      arr.sort((x, y) => x.createdAt.localeCompare(y.createdAt))
    }
    return [...map.entries()].map(([key, items]) => {
      const [side, ln] = key.split(':')
      return {
        side: side as DiffAnnotationSide,
        lineNumber: Number(ln),
        metadata: items,
      }
    })
  }, [fileAnnotations])

  /** Pierre renders annotation slots per (side, lineNumber); anchor composer at the lowest selected line. */
  const displayLineAnnotations = useMemo((): DiffLineAnnotation<DiffAnnotation[]>[] => {
    if (!pendingRange) return lineAnnotations
    const key = `${pendingRange.side}:${pendingRange.lineEnd}`
    if (lineAnnotations.some((a) => `${a.side}:${a.lineNumber}` === key)) {
      return lineAnnotations
    }
    return [
      ...lineAnnotations,
      {
        side: pendingRange.side,
        lineNumber: pendingRange.lineEnd,
        metadata: [],
      },
    ]
  }, [lineAnnotations, pendingRange])

  const handleLineSelectionStart = useCallback(() => {
    setPendingRange(null)
  }, [])

  const handleLineSelectionEnd = useCallback((range: PierreSelectedRange | null) => {
    setSelectedLines(range)
    if (!range) {
      setPendingRange(null)
      return
    }
    setPendingRange(normalizeDiffSelection(range))
  }, [])

  const patchOptions = useMemo(
    () => ({
      theme: DIFFS_THEME,
      themeType: 'dark' as const,
      diffStyle: inline ? ('unified' as const) : ('split' as const),
      diffIndicators: 'bars' as const,
      lineDiffType: 'word-alt' as const,
      overflow: 'scroll' as const,
      expandUnchanged: false,
      disableFileHeader: false,
      enableLineSelection: true,
      enableHoverUtility: true,
      onLineSelectionStart: handleLineSelectionStart,
      onLineSelectionEnd: handleLineSelectionEnd,
    }),
    [inline, handleLineSelectionStart, handleLineSelectionEnd],
  )

  const clearSelectionAndComposer = useCallback(() => {
    setSelectedLines(null)
    setPendingRange(null)
  }, [])

  const renderAnnotation = useCallback(
    (ann: DiffLineAnnotation<DiffAnnotation[]>) => {
      const items = ann.metadata ?? []
      const showComposer =
        pendingRange != null &&
        ann.side === pendingRange.side &&
        ann.lineNumber === pendingRange.lineEnd
      if (!items.length && !showComposer) return null
      return (
        <div className={annotationUi.annotationStack}>
          {items.map((a) => (
            <AnnotationBubble
              key={a.id}
              annotation={a}
              worktreePath={worktreePath}
              onChanged={onAnnotationsChanged}
              selected={selectedCommentIds?.has(a.id)}
              onToggle={onToggleComment}
            />
          ))}
          {showComposer && (
            <AnnotationComposer
              worktreePath={worktreePath}
              filePath={data.filePath}
              side={pendingRange.side}
              lineNumber={pendingRange.lineNumber}
              lineEnd={pendingRange.lineEnd}
              onCancel={clearSelectionAndComposer}
              onSaved={() => {
                clearSelectionAndComposer()
                onAnnotationsChanged()
              }}
            />
          )}
        </div>
      )
    },
    [
      pendingRange,
      worktreePath,
      data.filePath,
      onAnnotationsChanged,
      clearSelectionAndComposer,
      selectedCommentIds,
      onToggleComment,
    ],
  )

  // ── Accept / reject hunks ──

  const handleAcceptHunk = useCallback(
    (hunkIndex: number) => {
      if (!fileDiffState) return
      const next = diffAcceptRejectHunk(fileDiffState, hunkIndex, 'accept')
      setFileDiffState(next)
      onHunkAccepted?.(data.filePath, hunkIndex)
    },
    [fileDiffState, data.filePath, onHunkAccepted],
  )

  const handleRejectHunk = useCallback(
    (hunkIndex: number) => {
      if (!fileDiffState) return
      const next = diffAcceptRejectHunk(fileDiffState, hunkIndex, 'reject')
      setFileDiffState(next)
      onHunkRejected?.(data.filePath, hunkIndex)
    },
    [fileDiffState, data.filePath, onHunkRejected],
  )

  const handleAcceptAll = useCallback(() => {
    if (!fileDiffState) return
    let state = fileDiffState
    for (let i = state.hunks.length - 1; i >= 0; i--) {
      state = diffAcceptRejectHunk(state, i, 'accept')
    }
    setFileDiffState(state)
  }, [fileDiffState])

  const handleRejectAll = useCallback(() => {
    if (!fileDiffState) return
    let state = fileDiffState
    for (let i = state.hunks.length - 1; i >= 0; i--) {
      state = diffAcceptRejectHunk(state, i, 'reject')
    }
    setFileDiffState(state)
  }, [fileDiffState])

  const hunkCount = fileDiffState?.hunks.length ?? 0

  // ── Pierre native header metadata slot ──

  const renderHeaderMetadata = useCallback(
    (_props: RenderHeaderMetadataProps) => (
      <div className={styles.headerMeta}>
        <span className={`${styles.headerMetaBadge} ${styles[data.status] || ''}`}>
          {STATUS_LABELS[data.status] || '?'}
        </span>
        <button
          className={styles.headerMetaOpenBtn}
          onClick={(e) => {
            e.stopPropagation()
            onOpenFile(fullPath)
          }}
        >
          Open
        </button>
        {enableAcceptReject && hunkCount > 0 && (
          <div className={styles.headerMetaActions}>
            <span className={styles.headerMetaHunkCount}>
              {hunkCount} hunk{hunkCount !== 1 ? 's' : ''}
            </span>
            <button
              className={styles.rejectAllBtn}
              onClick={(e) => { e.stopPropagation(); handleRejectAll() }}
            >
              Reject all
            </button>
            <button
              className={styles.acceptAllBtn}
              onClick={(e) => { e.stopPropagation(); handleAcceptAll() }}
            >
              Accept all
            </button>
          </div>
        )}
        {enableAcceptReject && hunkCount === 0 && fileDiffState && (
          <span className={styles.headerMetaResolved}>All changes resolved</span>
        )}
      </div>
    ),
    [data.status, fullPath, onOpenFile, enableAcceptReject, hunkCount, fileDiffState, handleAcceptAll, handleRejectAll],
  )

  // ── Hover utility: "+" button on hovered lines ──

  const renderHoverUtility = useCallback(
    (getHoveredLine: () => { lineNumber: number; side: 'additions' | 'deletions' } | undefined) => (
      <button
        className={styles.hoverAddBtn}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          const hovered = getHoveredLine()
          if (!hovered) return
          setPendingRange({
            side: hovered.side as DiffAnnotationSide,
            lineNumber: hovered.lineNumber,
            lineEnd: hovered.lineNumber,
          })
        }}
      >
        +
      </button>
    ),
    [],
  )

  const hasAnnotationUi = displayLineAnnotations.length > 0
  const combinedMergePatch = isCombinedMergePatch(data.patch)

  return (
    <div className={styles.diffFileSection} id={`diff-${data.filePath}`}>
      {data.patch ? (
        combinedMergePatch ? (
          <>
            {/* Custom header only for combined merge patch fallback */}
            <div
              className={styles.fileHeader}
              onClick={() => onOpenFile(fullPath)}
            >
              <span className={`${styles.fileHeaderBadge} ${styles[data.status] || ''}`}>
                {STATUS_LABELS[data.status] || '?'}
              </span>
              <span className={styles.fileHeaderPath}>
                {dir && <span className={styles.fileHeaderDir}>{dir}</span>}
                {fileName}
              </span>
            </div>
            <p className={styles.combinedDiffNote}>
              Merge commit: combined diff (<code className={styles.combinedDiffCode}>diff --cc</code> /{' '}
              <code className={styles.combinedDiffCode}>@@@</code>) — showing raw patch. The rich diff
              viewer only supports unified <code className={styles.combinedDiffCode}>diff --git</code> format.
            </p>
            <pre className={styles.rawMergePatch}>{data.patch}</pre>
          </>
        ) : (
          <ErrorBoundary
            fallback={
              <div style={{ padding: 12, color: '#888', fontSize: 13 }}>
                Failed to render diff for this file.
              </div>
            }
          >
            {fileDiffState ? (
              <FileDiff<DiffAnnotation[]>
                fileDiff={fileDiffState}
                options={patchOptions}
                selectedLines={selectedLines}
                lineAnnotations={hasAnnotationUi ? displayLineAnnotations : undefined}
                renderAnnotation={hasAnnotationUi ? renderAnnotation : undefined}
                renderHeaderMetadata={renderHeaderMetadata}
                renderHoverUtility={renderHoverUtility}
              />
            ) : (
              <PatchDiff<DiffAnnotation[]>
                patch={data.patch}
                options={patchOptions}
                selectedLines={selectedLines}
                lineAnnotations={hasAnnotationUi ? displayLineAnnotations : undefined}
                renderAnnotation={hasAnnotationUi ? renderAnnotation : undefined}
                renderHeaderMetadata={renderHeaderMetadata}
                renderHoverUtility={renderHoverUtility}
              />
            )}
            {showPatchAnchorNote && fileAnnotations.length > 0 && (
              <p className={annotationUi.commitNote}>
                Comments reflect this patch; line anchors may not match other revisions.
              </p>
            )}
          </ErrorBoundary>
        )
      ) : (
        <div style={{ padding: 12, color: '#888', fontSize: 13 }}>No diff available</div>
      )}
    </div>
  )
})

// ── File strip (jump nav) ──

export function FileStrip({
  files,
  activeFile,
}: {
  files: DiffFileData[]
  activeFile: string | null
}) {
  const scrollTo = (filePath: string) => {
    const el = document.getElementById(`diff-${filePath}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className={styles.fileStrip}>
      {files.map((f) => (
        <button
          key={f.filePath}
          className={`${styles.fileStripItem} ${f.filePath === activeFile ? styles.active : ''}`}
          onClick={() => scrollTo(f.filePath)}
        >
          {f.filePath.split('/').pop()}
        </button>
      ))}
    </div>
  )
}
