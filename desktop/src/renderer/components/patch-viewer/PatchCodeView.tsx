import { forwardRef, useCallback, useMemo, type CSSProperties } from 'react'
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react'
import type { CodeViewDiffItem, DiffLineAnnotation } from '@pierre/diffs/react'
import type { CodeViewLineSelection, CodeViewOptions } from '@pierre/diffs'
import type { AnnotationPatch, DiffAnnotation, DiffAnnotationSide } from '@shared/diff-annotation-types'
import { STATUS_LABELS } from '@shared/status-labels'
import { CODEX_ABSOLUTELY_DIFF_THEME_ID } from '../../themes/diff/codex-absolutely-dark'
import { ReviewCommentCard } from './ReviewCommentCard'
import { ReviewCommentComposer } from './ReviewCommentComposer'
import type { PatchViewFile } from './patch-view-model'
import { draftToSelection, draftTargetFor, type PatchDraftTarget } from './line-selection'
import { filePathFromItemId } from './patch-utils'
import { normalizePath } from './review-threads'
import { getSuggestionSeedForLineRange } from './review-suggestion-seeds'
import editorStyles from '../Editor/Editor.module.css'
import annotationUi from '../Editor/AnnotationBubble.module.css'

/**
 * Pierre `[data-hover-slot]` is a flex row without vertical alignment; the
 * slotted "+" wrapper needs centering. Injected via `unsafeCSS` (relocated from
 * the retired DiffFileSection).
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
/* rudu parity: amber selected-line marker (matches the "+" affordance accent) */
[data-column-number][data-selected-line]::before {
  background-color: #f59e0b;
  background-image: none;
}
/* Kill Pierre's bluish selected-line wash — the amber gutter marker is the only
   review-range cue (rudu). Code text stays its normal colour so it reads cleanly. */
[data-selected-line]:is([data-line],[data-line-annotation],[data-gutter-buffer],[data-column-number]) {
  --diffs-line-bg: var(--diffs-computed-diff-line-bg) !important;
}
/* Native text-selection (⌘C copy) uses a soft amber tint instead of OS blue. */
[data-code] ::selection {
  background-color: rgba(245, 158, 11, 0.3);
}
/* rudu parity (overflow:'scroll'): hide diff scrollbars so long lines scroll cleanly */
[data-overflow='scroll'],
[data-code] {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
[data-overflow='scroll']::-webkit-scrollbar,
[data-code]::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
[data-code]::-webkit-scrollbar-track,
[data-code]::-webkit-scrollbar-corner,
[data-code]::-webkit-scrollbar-thumb,
[data-diff]:hover [data-code]::-webkit-scrollbar-thumb,
[data-file]:hover [data-code]::-webkit-scrollbar-thumb {
  background-color: transparent !important;
}
`.trim()

const PIERRE_MAX = 2000

/**
 * Pre-measure layout estimate for CodeView's virtualizer (rudu's
 * `VIRTUAL_FILE_METRICS`). CodeView refines these with measured deltas, but it
 * needs a starting estimate to size items and compute the render window — without
 * it the surface paints blank/janky on first load.
 */
const ITEM_METRICS = {
  hunkLineCount: 50,
  lineHeight: 20,
  diffHeaderHeight: 44,
  hunkSeparatorHeight: 32,
  spacing: 8,
} as const

/** Flat layout — our own toolbar/file-strip owns surrounding spacing. */
const FLAT_LAYOUT = { paddingTop: 0, paddingBottom: 0, gap: 0 } as const

/** `display:contents` wrapper adds no box, so the CodeView root stays the scroll container. */
const CONTENTS_WRAPPER_STYLE: CSSProperties = { display: 'contents' }

export type CodeViewDiffItemArr = CodeViewDiffItem<DiffAnnotation[]>

export interface PatchCodeViewProps {
  items: CodeViewDiffItemArr[]
  byItemId: Map<string, PatchViewFile>
  inline: boolean
  worktreePath: string
  draftTarget: PatchDraftTarget | null
  composerBody: string
  onComposerBodyChange: (body: string) => void
  onComposerSeedPristine?: (body: string) => void
  onComposerCancel: () => void
  onComposerSaved: () => void
  onSelectionChange: (selection: CodeViewLineSelection | null) => void
  onApplyAnnotation: (patch: AnnotationPatch) => void
  onOpenFile: (fullPath: string) => void
  onToggleCollapsed: (filePath: string, collapsed: boolean) => void
  onToggleViewed?: (filePath: string, viewed: boolean) => void
  onToggleShowFullContext: (filePath: string, next: boolean) => void
  onAddToChat: (target: PatchDraftTarget) => void
  viewedFilePaths?: ReadonlySet<string>
  enableViewedToggle?: boolean
  tourMode?: boolean
  activeTourAnnotationId?: string
  selectedCommentIds?: Set<string>
  onToggleComment?: (id: string) => void
  onScroll?: (scrollTop: number) => void
  className?: string
  style?: CSSProperties
}

export const PatchCodeView = forwardRef<CodeViewHandle<DiffAnnotation[]>, PatchCodeViewProps>(
  function PatchCodeView(props, ref) {
    const {
      items,
      byItemId,
      inline,
      worktreePath,
      draftTarget,
      composerBody,
      onComposerBodyChange,
      onComposerSeedPristine,
      onComposerCancel,
      onComposerSaved,
      onSelectionChange,
      onApplyAnnotation,
      onOpenFile,
      onToggleCollapsed,
      onToggleViewed,
      onToggleShowFullContext,
      onAddToChat,
      viewedFilePaths,
      enableViewedToggle,
      tourMode,
      activeTourAnnotationId,
      selectedCommentIds,
      onToggleComment,
      onScroll,
      className,
      style,
    } = props

    const selectedLines = useMemo<CodeViewLineSelection | null>(
      () => (draftTarget ? draftToSelection(draftTarget) : null),
      [draftTarget],
    )

    const renderGutterUtility = useCallback(
      (
        getHoveredLine: () => { lineNumber: number; side?: DiffAnnotationSide } | undefined,
        item: { id: string },
      ) => (
        <button
          className={editorStyles.hoverAddBtn}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            const hovered = getHoveredLine()
            if (!hovered || hovered.side == null) return
            const filePath = filePathFromItemId(item.id)
            onSelectionChange(
              draftToSelection(draftTargetFor(filePath, hovered.side, hovered.lineNumber)),
            )
          }}
        >
          +
        </button>
      ),
      [onSelectionChange],
    )

    const renderHeaderMetadata = useCallback(
      (item: { id: string }) => {
        const viewFile = byItemId.get(item.id)
        if (!viewFile) return null
        const filePath = viewFile.file.filePath
        const collapsed = viewFile.collapsed
        const status = viewFile.file.status
        const fullPath = filePath.startsWith('/') ? filePath : `${worktreePath}/${filePath}`
        const viewed = viewedFilePaths?.has(filePath) ?? false
        return (
          <div className={editorStyles.headerMeta} data-file-path={filePath} data-testid="patch-file-header">
            <span data-file-anchor={filePath} hidden />
            {enableViewedToggle && onToggleViewed && (
              <label
                className={editorStyles.viewedLabel}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  className={editorStyles.viewedInput}
                  checked={viewed}
                  onChange={(e) => onToggleViewed(filePath, e.target.checked)}
                  data-testid="diff-viewed-toggle"
                  aria-label="Viewed: collapse this file"
                />
                <span className={editorStyles.viewedLabelText}>Viewed</span>
              </label>
            )}
            <button
              className={editorStyles.headerMetaContextBtn}
              data-testid="diff-collapse-toggle"
              aria-pressed={!collapsed}
              onClick={(e) => {
                e.stopPropagation()
                onToggleCollapsed(filePath, !collapsed)
              }}
            >
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
            <span className={`${editorStyles.headerMetaBadge} ${editorStyles[status] || ''}`}>
              {STATUS_LABELS[status] || '?'}
            </span>
            {viewFile.canShowFullContext && (
              <button
                className={`${editorStyles.headerMetaContextBtn} ${viewFile.showFullContext ? editorStyles.active : ''}`}
                data-testid="show-full-file-toggle"
                aria-pressed={viewFile.showFullContext}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleShowFullContext(filePath, !viewFile.showFullContext)
                }}
              >
                {viewFile.showFullContext ? 'Changed only' : 'Show full file'}
              </button>
            )}
            <button
              className={editorStyles.headerMetaOpenBtn}
              onClick={(e) => {
                e.stopPropagation()
                onOpenFile(fullPath)
              }}
            >
              Open
            </button>
          </div>
        )
      },
      [byItemId, worktreePath, viewedFilePaths, enableViewedToggle, onToggleViewed, onToggleCollapsed, onToggleShowFullContext, onOpenFile],
    )

    const renderAnnotation = useCallback(
      (annotation: DiffLineAnnotation<DiffAnnotation[]>, item: { id: string }) => {
        const viewFile = byItemId.get(item.id)
        const filePath = viewFile?.file.filePath ?? filePathFromItemId(item.id)
        const comments = annotation.metadata ?? []
        const showComposer =
          draftTarget != null &&
          normalizePath(draftTarget.filePath) === normalizePath(filePath) &&
          annotation.side === draftTarget.side &&
          annotation.lineNumber === draftTarget.lineEnd
        if (!comments.length && !showComposer) return null
        return (
          <div className={annotationUi.annotationStack}>
            {comments.map((a) => (
              <ReviewCommentCard
                key={a.id}
                annotation={a}
                worktreePath={worktreePath}
                onApply={onApplyAnnotation}
                tourState={tourMode ? (a.id === activeTourAnnotationId ? 'active' : 'inactive') : 'off'}
                selected={selectedCommentIds?.has(a.id)}
                onToggle={onToggleComment}
              />
            ))}
            {showComposer && draftTarget && (
              <ReviewCommentComposer
                key={`${draftTarget.side}-${draftTarget.lineNumber}-${draftTarget.lineEnd}`}
                worktreePath={worktreePath}
                filePath={filePath}
                side={draftTarget.side}
                lineNumber={draftTarget.lineNumber}
                lineEnd={draftTarget.lineEnd}
                body={composerBody}
                onBodyChange={onComposerBodyChange}
                onSeedPristine={onComposerSeedPristine}
                onCancel={onComposerCancel}
                onSaved={onComposerSaved}
                onApply={onApplyAnnotation}
                allowSuggestion
                suggestionSeed={
                  draftTarget.side === 'additions'
                    ? getSuggestionSeedForLineRange(
                        viewFile?.fileDiff,
                        draftTarget.lineNumber,
                        draftTarget.lineEnd,
                      )
                    : undefined
                }
                selectedLineLabel={
                  draftTarget.lineEnd > draftTarget.lineNumber
                    ? `Lines ${draftTarget.lineNumber}–${draftTarget.lineEnd}`
                    : undefined
                }
                onAddToChat={() => onAddToChat(draftTarget)}
              />
            )}
          </div>
        )
      },
      [byItemId, draftTarget, worktreePath, composerBody, onComposerBodyChange, onComposerSeedPristine, onComposerCancel, onComposerSaved, onSelectionChange, onApplyAnnotation, tourMode, activeTourAnnotationId, selectedCommentIds, onToggleComment, onAddToChat],
    )

    const options = useMemo<CodeViewOptions<DiffAnnotation[]>>(
      () => ({
        theme: CODEX_ABSOLUTELY_DIFF_THEME_ID,
        themeType: 'dark',
        // diffStyle kept as our split/inline toggle (rudu is always 'unified').
        diffStyle: inline ? 'unified' : 'split',
        // rudu render options: 'bars' indicators, intra-line 'word' diff, scroll overflow.
        diffIndicators: 'bars',
        lineDiffType: 'word',
        maxLineDiffLength: PIERRE_MAX,
        tokenizeMaxLineLength: PIERRE_MAX,
        overflow: 'scroll',
        // CodeView defaults this to true. We keep it false so changed-only files
        // collapse unchanged regions (separators + gap expanders); per-file "show
        // full file" is emulated by re-parsing into a single gap-free hunk.
        expandUnchanged: false,
        enableLineSelection: true,
        enableGutterUtility: true,
        controlledSelection: true,
        stickyHeaders: true,
        // Layout estimate the virtualizer uses BEFORE a line is measured. Without
        // it CodeView can't size items, so the render window is wrong and the
        // surface renders blank/janky on load (rudu's VIRTUAL_FILE_METRICS).
        itemMetrics: ITEM_METRICS,
        // Zero out CodeView's default 8px container padding/gap so our own
        // toolbar/strip own the spacing (rudu uses the same flat layout).
        layout: FLAT_LAYOUT,
        unsafeCSS: HOVER_UTILITY_UNSAFE_CSS,
      }),
      [inline],
    )

    // The CodeView root element IS the vertical scroll container — it reads its
    // OWN scrollTop to drive virtualization. It must therefore be height-bounded
    // AND have `overflow-y: auto`; a bare `flex:1` child (overflow:visible) spills
    // its content and cannot scroll, which is why the surface was unscrollable.
    const rootStyle = useMemo<CSSProperties>(
      () => ({
        minHeight: 0,
        minWidth: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        overflowAnchor: 'none',
        ...style,
      }),
      [style],
    )

    // Selection routing: dragging across the code text (or the line-number gutter,
    // or the hover "+" slot) selects a review range and opens the composer — this is
    // the pre-rudu behavior the user expects (drag line 100→110, or from mid-line,
    // to comment on the range). Pierre's `enableLineSelection` handles the content
    // drag natively via `onSelectedLinesChange`; we no longer intercept it.
    return (
      <div style={CONTENTS_WRAPPER_STYLE}>
        <CodeView<DiffAnnotation[]>
          ref={ref}
          className={className}
          style={rootStyle}
          items={items}
          options={options}
          selectedLines={selectedLines}
          onSelectedLinesChange={onSelectionChange}
          renderAnnotation={renderAnnotation}
          renderHeaderMetadata={renderHeaderMetadata}
          renderGutterUtility={renderGutterUtility}
          onScroll={onScroll ? (scrollTop) => onScroll(scrollTop) : undefined}
        />
      </div>
    )
  },
)
