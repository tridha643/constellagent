import { useState, useCallback, memo, useMemo, useEffect, useRef } from 'react'
import {
  PatchDiff,
  FileDiff,
  type DiffLineAnnotation,
  type FileDiffMetadata,
} from '@pierre/diffs/react'
import { diffAcceptRejectHunk, getSingularPatch } from '@pierre/diffs'
import type { DiffAnnotation, DiffAnnotationSide } from '@shared/diff-annotation-types'
import type { GitHunkActionRequest } from '@shared/git-hunk-action-types'
import { STATUS_LABELS } from '../../../shared/status-labels'
import type { DiffFileData } from '../../types/working-tree-diff'
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

function getHunkActionLineKey(hunk: FileDiffMetadata['hunks'][number]): string {
  return `${hunk.deletionStart}:${hunk.additionStart}`
}

function summarizePatchChanges(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions += 1
    else if (line.startsWith('-')) deletions += 1
  }
  return { additions, deletions }
}

// ── Per-file diff section ──

export interface DiffFileSectionProps {
  data: DiffFileData
  defaultCollapsed?: boolean
  inline: boolean
  defaultShowFullContext: boolean
  worktreePath: string
  onOpenFile: (filePath: string) => void
  fileAnnotations: DiffAnnotation[]
  onAnnotationsChanged: () => void
  showPatchAnchorNote: boolean
  activeTourAnnotationId?: string
  selectedCommentIds?: Set<string>
  onToggleComment?: (id: string) => void
  tourMode?: boolean
  enableAcceptReject?: boolean
  onHunkAccepted?: (request: GitHunkActionRequest) => Promise<void> | void
  onHunkRejected?: (request: GitHunkActionRequest) => Promise<void> | void
  onEnsureFileDiff?: (filePath: string) => void
}

export const DiffFileSection = memo(function DiffFileSection({
  data,
  defaultCollapsed = false,
  inline,
  defaultShowFullContext,
  worktreePath,
  onOpenFile,
  fileAnnotations,
  onAnnotationsChanged,
  showPatchAnchorNote,
  activeTourAnnotationId,
  selectedCommentIds,
  onToggleComment,
  tourMode,
  enableAcceptReject,
  onHunkAccepted,
  onHunkRejected,
  onEnsureFileDiff,
}: DiffFileSectionProps) {
  const [selectedLines, setSelectedLines] = useState<PierreSelectedRange | null>(null)
  const [showFullContextOverride, setShowFullContextOverride] = useState<boolean | null>(null)
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [pendingRange, setPendingRange] = useState<{
    side: DiffAnnotationSide
    lineNumber: number
    lineEnd: number
  } | null>(null)

  const [fileDiffState, setFileDiffState] = useState<FileDiffMetadata | null>(null)
  const [hiddenHunkState, setHiddenHunkState] = useState<{ sourceKey: string; keys: string[] }>({
    sourceKey: '',
    keys: [],
  })
  const [pendingHunkAction, setPendingHunkAction] = useState<string | null>(null)
  const collapseTouchedRef = useRef(false)
  const fileDiffSourceKeyRef = useRef<string | null>(null)
  const fileDiffSourceKey = `${data.filePath}\u0000${data.patch}`
  const hiddenHunkKeys =
    hiddenHunkState.sourceKey === fileDiffSourceKey ? hiddenHunkState.keys : []
  const canApplyAcceptReject =
    !!enableAcceptReject
    && data.status === 'modified'
    && data.staged !== true
    && data.hasMixedStageState !== true
    && !isCombinedMergePatch(data.patch)

  useEffect(() => {
    setShowFullContextOverride(null)
  }, [data.filePath, data.patch, data.fileDiff])

  useEffect(() => {
    collapseTouchedRef.current = false
    setCollapsed(defaultCollapsed)
  }, [data.filePath, defaultCollapsed])

  useEffect(() => {
    if (collapseTouchedRef.current) return
    setCollapsed(defaultCollapsed)
  }, [defaultCollapsed])

  useEffect(() => {
    if (collapsed) return
    if (pendingHunkAction) return
    if (fileDiffState && fileDiffSourceKeyRef.current === fileDiffSourceKey) return
    fileDiffSourceKeyRef.current = fileDiffSourceKey
    if (data.fileDiff) {
      setFileDiffState(data.fileDiff)
      return
    }
    if (!data.patch || isCombinedMergePatch(data.patch)) {
      setFileDiffState(null)
      return
    }
    try {
      setFileDiffState(getSingularPatch(data.patch))
    } catch {
      setFileDiffState(null)
    }
  }, [collapsed, data.fileDiff, data.patch, fileDiffSourceKey, fileDiffState, pendingHunkAction])

  useEffect(() => {
    if (collapsed) return
    if (data.fileDiff) return
    if (!data.patch || isCombinedMergePatch(data.patch)) return
    onEnsureFileDiff?.(data.filePath)
  }, [collapsed, data.fileDiff, data.patch, data.filePath, onEnsureFileDiff])

  const parts = data.filePath.split('/')
  const fileName = parts.pop()
  const dir = parts.length > 0 ? parts.join('/') + '/' : ''

  const fullPath = data.filePath.startsWith('/')
    ? data.filePath
    : `${worktreePath}/${data.filePath}`
  const canShowFullContext = data.fileDiff != null
  const showFullContext = canShowFullContext && (showFullContextOverride ?? defaultShowFullContext)
  const patchSummary = useMemo(() => summarizePatchChanges(data.patch), [data.patch])

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
    if (!canApplyAcceptReject || !fileDiffState) return []
    return fileDiffState.hunks.flatMap((hunk, i) => (
      hiddenHunkKeys.includes(getHunkActionLineKey(hunk))
        ? []
        : [{
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
    }]
    ))
  }, [canApplyAcceptReject, fileDiffState, data.filePath, hiddenHunkKeys])

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
      expandUnchanged: showFullContext,
      disableFileHeader: false,
      enableLineSelection: true,
      enableHoverUtility: true,
      unsafeCSS: HOVER_UTILITY_UNSAFE_CSS,
      onLineSelectionStart: handleLineSelectionStart,
      onLineSelectionEnd: handleLineSelectionEnd,
    }),
    [inline, showFullContext, handleLineSelectionStart, handleLineSelectionEnd],
  )

  const clearSelectionAndComposer = useCallback(() => {
    setSelectedLines(null)
    setPendingRange(null)
  }, [])

  // ── Accept / reject hunks ──

  const runHunkAction = useCallback(
    (action: 'keep' | 'undo', hunkIndex: number) => {
      if (!fileDiffState || !data.patch || pendingHunkAction) return
      const callback = action === 'keep' ? onHunkAccepted : onHunkRejected
      if (!callback) return
      const hunk = fileDiffState.hunks[hunkIndex]
      if (!hunk) return
      let nextState: FileDiffMetadata
      try {
        nextState = diffAcceptRejectHunk(fileDiffState, hunkIndex, action === 'keep' ? 'accept' : 'reject')
      } catch {
        nextState = fileDiffState
      }
      const previousState = fileDiffState
      const hiddenKey = getHunkActionLineKey(hunk)
      const request: GitHunkActionRequest = {
        filePath: data.filePath,
        patch: data.patch,
        hunkIndex,
        action,
        status: data.status,
      }
      const actionKey = `${action}:${hunkIndex}`
      fileDiffSourceKeyRef.current = fileDiffSourceKey
      setPendingHunkAction(actionKey)
      setFileDiffState(nextState)
      setHiddenHunkState((current) => {
        const keys = current.sourceKey === fileDiffSourceKey ? current.keys : []
        return {
          sourceKey: fileDiffSourceKey,
          keys: keys.includes(hiddenKey) ? keys : [...keys, hiddenKey],
        }
      })
      void (async () => {
        try {
          await callback(request)
        } catch {
          setFileDiffState(previousState)
          setHiddenHunkState((current) => {
            const keys = current.sourceKey === fileDiffSourceKey ? current.keys : []
            return {
              sourceKey: fileDiffSourceKey,
              keys: keys.filter((key) => key !== hiddenKey),
            }
          })
        } finally {
          setPendingHunkAction((current) => (current === actionKey ? null : current))
        }
      })()
    },
    [
      data.filePath,
      data.patch,
      data.status,
      fileDiffSourceKey,
      fileDiffState,
      onHunkAccepted,
      onHunkRejected,
      pendingHunkAction,
    ],
  )

  const handleAcceptHunk = useCallback(
    (hunkIndex: number) => {
      runHunkAction('keep', hunkIndex)
    },
    [runHunkAction],
  )

  const handleRejectHunk = useCallback(
    (hunkIndex: number) => {
      runHunkAction('undo', hunkIndex)
    },
    [runHunkAction],
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
                disabled={pendingHunkAction != null}
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
    (_props: unknown) => (
      <div className={styles.headerMeta}>
        <button
          className={styles.headerMetaContextBtn}
          data-testid="diff-collapse-toggle"
          aria-pressed={!collapsed}
          onClick={(e) => {
            e.stopPropagation()
            collapseTouchedRef.current = true
            setCollapsed((prev) => !prev)
          }}
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
        <span className={`${styles.headerMetaBadge} ${styles[data.status] || ''}`}>
          {STATUS_LABELS[data.status] || '?'}
        </span>
        {canShowFullContext && (
          <button
            className={`${styles.headerMetaContextBtn} ${showFullContext ? styles.active : ''}`}
            data-testid="show-full-file-toggle"
            aria-pressed={showFullContext}
            onClick={(e) => {
              e.stopPropagation()
              setShowFullContextOverride((prev) => !(prev ?? defaultShowFullContext))
            }}
          >
            {showFullContext ? 'Changed only' : 'Show full file'}
          </button>
        )}
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
    [canShowFullContext, collapsed, data.status, defaultShowFullContext, fullPath, onOpenFile, showFullContext],
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
  const combinedMergePatch = !data.fileDiff && isCombinedMergePatch(data.patch)

  const expandSection = useCallback(() => {
    collapseTouchedRef.current = true
    setCollapsed(false)
  }, [])

  const toggleCollapsed = useCallback(() => {
    collapseTouchedRef.current = true
    setCollapsed((prev) => !prev)
  }, [])

  if (collapsed) {
    return (
      <div className={styles.diffFileSection} id={`diff-${data.filePath}`}>
        <div
          className={styles.collapsedFileHeader}
          role="button"
          tabIndex={0}
          onClick={expandSection}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              expandSection()
            }
          }}
        >
          <span className={`${styles.fileHeaderBadge} ${styles[data.status] || ''}`}>
            {STATUS_LABELS[data.status] || '?'}
          </span>
          <span className={styles.fileHeaderPath}>
            {dir && <span className={styles.fileHeaderDir}>{dir}</span>}
            {fileName}
          </span>
          <div className={styles.headerMeta}>
            {(patchSummary.additions > 0 || patchSummary.deletions > 0) && (
              <span className={styles.collapsedDiffSummary}>
                {patchSummary.additions > 0 ? `+${patchSummary.additions}` : ''}
                {patchSummary.additions > 0 && patchSummary.deletions > 0 ? ' ' : ''}
                {patchSummary.deletions > 0 ? `-${patchSummary.deletions}` : ''}
              </span>
            )}
            <button
              className={styles.headerMetaContextBtn}
              data-testid="diff-collapse-toggle"
              aria-pressed="false"
              onClick={(e) => {
                e.stopPropagation()
                toggleCollapsed()
              }}
            >
              Expand
            </button>
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
        </div>
      </div>
    )
  }

  return (
    <div className={styles.diffFileSection} id={`diff-${data.filePath}`}>
      <div className={styles.expandedFileBody}>
      {data.patch || fileDiffState ? (
        combinedMergePatch ? (
          <>
            {/* Custom header only for combined merge patch fallback */}
            <div
              className={styles.fileHeader}
              role="button"
              tabIndex={0}
              onClick={() => onOpenFile(fullPath)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpenFile(fullPath)
                }
              }}
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
    </div>
  )
})

// ── File strip (jump nav) ──

export function FileStrip({
  files,
  activeFile,
  onSelectFile,
}: {
  files: DiffFileData[]
  activeFile: string | null
  onSelectFile?: (filePath: string) => void
}) {
  const scrollTo = (filePath: string) => {
    if (onSelectFile) {
      onSelectFile(filePath)
      return
    }
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
