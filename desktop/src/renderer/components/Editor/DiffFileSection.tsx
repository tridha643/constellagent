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
import { CommentBubble, CommentComposer, HunkActionAnnotation } from './AnnotationBubble'
import annotationUi from './AnnotationBubble.module.css'
import styles from './Editor.module.css'
import { getPreferredScrollBehavior } from '../../utils/preferred-scroll-behavior'

const DIFFS_THEME = 'pierre-dark' as const

/**
 * Pierre’s `[data-hover-slot]` is a flex row without vertical alignment; the React slotted
 * wrapper uses `HoverSlotStyles` (absolute + `text-align`) which does not center the `+`
 * button on the line. Injected in `@layer unsafe` via `unsafeCSS`.
 */
const HOVER_UTILITY_UNSAFE_CSS = `
[data-hover-slot] {
  align-items: center;
}
::slotted([slot="hover-slot"]) {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  position: static !important;
  top: auto !important;
  bottom: auto !important;
  width: 100%;
  height: 100%;
  min-height: 100%;
  box-sizing: border-box;
}
`.trim()

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

// Sentinel key prefix for hunk-action annotations
const HUNK_ACTION_KEY = '__hunk_action__'

// ── Per-file diff section ──

export interface DiffFileSectionProps {
  data: DiffFileData
  inline: boolean
  worktreePath: string
  onOpenFile: (filePath: string) => void
  worktreeAnnotations: DiffAnnotation[]
  onAnnotationsChanged: () => void
  showPatchAnchorNote: boolean
  activeTourAnnotationId?: string
  selectedCommentIds?: Set<string>
  onToggleComment?: (id: string) => void
  tourMode?: boolean
  enableAcceptReject?: boolean
  onHunkAccepted?: (filePath: string, hunkIndex: number) => void
  onHunkRejected?: (filePath: string, hunkIndex: number) => void
  onFileAccepted?: (filePath: string, status: string) => void
  onFileRejected?: (filePath: string, status: string) => void
}

export const DiffFileSection = memo(function DiffFileSection({
  data,
  inline,
  worktreePath,
  onOpenFile,
  worktreeAnnotations,
  onAnnotationsChanged,
  showPatchAnchorNote,
  activeTourAnnotationId,
  selectedCommentIds,
  onToggleComment,
  tourMode,
  enableAcceptReject,
  onHunkAccepted,
  onHunkRejected,
  onFileAccepted,
  onFileRejected,
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

  // Build hunk-start annotation entries for accept/reject buttons
  const hunkStartAnnotations = useMemo((): DiffLineAnnotation<DiffAnnotation[]>[] => {
    if (!enableAcceptReject || !fileDiffState) return []
    return fileDiffState.hunks.map((hunk, i) => ({
      side: 'additions' as DiffAnnotationSide,
      lineNumber: hunk.additionStart,
      metadata: [{
        id: `${HUNK_ACTION_KEY}${i}`,
        filePath: data.filePath,
        side: 'additions' as const,
        lineNumber: hunk.additionStart,
        body: '',
        createdAt: '',
        resolved: false,
      }],
    }))
  }, [enableAcceptReject, fileDiffState, data.filePath])

  /** Pierre renders annotation slots per (side, lineNumber); anchor composer at the lowest selected line. */
  const displayLineAnnotations = useMemo((): DiffLineAnnotation<DiffAnnotation[]>[] => {
    // Merge line annotations + hunk start annotations
    const merged = new Map<string, DiffLineAnnotation<DiffAnnotation[]>>()

    for (const ann of lineAnnotations) {
      const key = `${ann.side}:${ann.lineNumber}`
      merged.set(key, { ...ann, metadata: [...(ann.metadata ?? [])] })
    }

    for (const hunkAnn of hunkStartAnnotations) {
      const key = `${hunkAnn.side}:${hunkAnn.lineNumber}`
      const existing = merged.get(key)
      if (existing) {
        existing.metadata = [...(hunkAnn.metadata ?? []), ...(existing.metadata ?? [])]
      } else {
        merged.set(key, { ...hunkAnn })
      }
    }

    if (pendingRange) {
      const key = `${pendingRange.side}:${pendingRange.lineEnd}`
      if (!merged.has(key)) {
        merged.set(key, {
          side: pendingRange.side,
          lineNumber: pendingRange.lineEnd,
          metadata: [],
        })
      }
    }

    return [...merged.values()]
  }, [lineAnnotations, hunkStartAnnotations, pendingRange])

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
      unsafeCSS: HOVER_UTILITY_UNSAFE_CSS,
      onLineSelectionStart: handleLineSelectionStart,
      onLineSelectionEnd: handleLineSelectionEnd,
    }),
    [inline, handleLineSelectionStart, handleLineSelectionEnd],
  )

  const clearSelectionAndComposer = useCallback(() => {
    setSelectedLines(null)
    setPendingRange(null)
  }, [])

  // ── Accept / reject hunks ──

  const handleAcceptHunk = useCallback(
    (hunkIndex: number) => {
      if (!fileDiffState) return
      const next = diffAcceptRejectHunk(fileDiffState, hunkIndex, 'accept')
      setFileDiffState(next)
      onHunkAccepted?.(data.filePath, hunkIndex)
      onFileAccepted?.(data.filePath, data.status)
    },
    [fileDiffState, data.filePath, data.status, onHunkAccepted, onFileAccepted],
  )

  const handleRejectHunk = useCallback(
    (hunkIndex: number) => {
      if (!fileDiffState) return
      const next = diffAcceptRejectHunk(fileDiffState, hunkIndex, 'reject')
      setFileDiffState(next)
      onHunkRejected?.(data.filePath, hunkIndex)
      onFileRejected?.(data.filePath, data.status)
    },
    [fileDiffState, data.filePath, data.status, onHunkRejected, onFileRejected],
  )

  const renderAnnotation = useCallback(
    (ann: DiffLineAnnotation<DiffAnnotation[]>) => {
      const items = ann.metadata ?? []
      const hunkActions = items.filter((a) => a.id.startsWith(HUNK_ACTION_KEY))
      const comments = items.filter((a) => !a.id.startsWith(HUNK_ACTION_KEY))
      const showComposer =
        pendingRange != null &&
        ann.side === pendingRange.side &&
        ann.lineNumber === pendingRange.lineEnd
      if (!hunkActions.length && !comments.length && !showComposer) return null
      return (
        <div className={annotationUi.annotationStack}>
          {hunkActions.map((a) => {
            const idx = parseInt(a.id.slice(HUNK_ACTION_KEY.length), 10)
            return (
              <HunkActionAnnotation
                key={a.id}
                hunkIndex={idx}
                onAccept={handleAcceptHunk}
                onReject={handleRejectHunk}
              />
            )
          })}
          {comments.map((a) => (
            <CommentBubble
              key={a.id}
              annotation={a}
              worktreePath={worktreePath}
              onChanged={onAnnotationsChanged}
              tourState={tourMode ? (a.id === activeTourAnnotationId ? 'active' : 'inactive') : 'off'}
              selected={selectedCommentIds?.has(a.id)}
              onToggle={onToggleComment}
            />
          ))}
          {showComposer && (
            <CommentComposer
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
      tourMode,
      activeTourAnnotationId,
      handleAcceptHunk,
      handleRejectHunk,
    ],
  )

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
      </div>
    ),
    [data.status, fullPath, onOpenFile],
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
    el?.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: 'start' })
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
