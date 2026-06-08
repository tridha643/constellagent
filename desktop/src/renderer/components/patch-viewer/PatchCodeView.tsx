import { forwardRef, useCallback, useMemo, type CSSProperties } from 'react'
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react'
import type { CodeViewDiffItem, DiffLineAnnotation } from '@pierre/diffs/react'
import type { CodeViewLineSelection, CodeViewOptions } from '@pierre/diffs'
import type { AnnotationPatch, DiffAnnotation, DiffAnnotationSide } from '@shared/diff-annotation-types'
import { STATUS_LABELS } from '@shared/status-labels'
import { CODEX_ABSOLUTELY_DIFF_THEME_ID } from '../../themes/diff/codex-absolutely-dark'
import { ReviewCommentCard } from './ReviewCommentCard'
import { ReviewCommentComposer } from './ReviewCommentComposer'
import { HunkActionAnnotation } from './HunkActionAnnotation'
import { HUNK_ACTION_KEY } from './patch-view-model'
import type { PatchViewFile } from './patch-view-model'
import { draftToSelection, draftTargetFor, type PatchDraftTarget } from './line-selection'
import { filePathFromItemId } from './patch-utils'
import { normalizePath } from './review-threads'
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
`.trim()

const PIERRE_MAX = 2000

export type CodeViewDiffItemArr = CodeViewDiffItem<DiffAnnotation[]>

export interface PatchCodeViewProps {
  items: CodeViewDiffItemArr[]
  byItemId: Map<string, PatchViewFile>
  inline: boolean
  worktreePath: string
  draftTarget: PatchDraftTarget | null
  composerBody: string
  onComposerBodyChange: (body: string) => void
  onSelectionChange: (selection: CodeViewLineSelection | null) => void
  onApplyAnnotation: (patch: AnnotationPatch) => void
  onOpenFile: (fullPath: string) => void
  onHunkAccept: (filePath: string, hunkIndex: number) => void
  onHunkReject: (filePath: string, hunkIndex: number) => void
  hunkActionPending: boolean
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

function languageIdFromPath(filePath: string): string {
  const ext = filePath.split('.').pop() ?? ''
  return ext.toLowerCase()
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
      onSelectionChange,
      onApplyAnnotation,
      onOpenFile,
      onHunkAccept,
      onHunkReject,
      hunkActionPending,
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
        const metadata = annotation.metadata ?? []
        const hunkActions = metadata.filter((a) => a.id.startsWith(HUNK_ACTION_KEY))
        const comments = metadata.filter((a) => !a.id.startsWith(HUNK_ACTION_KEY))
        const showComposer =
          draftTarget != null &&
          normalizePath(draftTarget.filePath) === normalizePath(filePath) &&
          annotation.side === draftTarget.side &&
          annotation.lineNumber === draftTarget.lineEnd
        if (!hunkActions.length && !comments.length && !showComposer) return null
        return (
          <div className={annotationUi.annotationStack}>
            {hunkActions.map((a) => {
              const idx = parseInt(a.id.slice(HUNK_ACTION_KEY.length), 10)
              return (
                <HunkActionAnnotation
                  key={a.id}
                  hunkIndex={idx}
                  onAccept={(hunkIndex) => onHunkAccept(filePath, hunkIndex)}
                  onReject={(hunkIndex) => onHunkReject(filePath, hunkIndex)}
                  disabled={hunkActionPending}
                />
              )
            })}
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
                onCancel={() => onSelectionChange(null)}
                onSaved={() => onSelectionChange(null)}
                onApply={onApplyAnnotation}
                allowSuggestion
                suggestionLanguage={languageIdFromPath(filePath)}
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
      [byItemId, draftTarget, worktreePath, composerBody, onComposerBodyChange, onSelectionChange, onApplyAnnotation, onHunkAccept, onHunkReject, hunkActionPending, tourMode, activeTourAnnotationId, selectedCommentIds, onToggleComment, onAddToChat],
    )

    const options = useMemo<CodeViewOptions<DiffAnnotation[]>>(
      () => ({
        theme: CODEX_ABSOLUTELY_DIFF_THEME_ID,
        themeType: 'dark',
        diffStyle: inline ? 'unified' : 'split',
        diffIndicators: 'bars',
        lineDiffType: 'word-alt',
        maxLineDiffLength: PIERRE_MAX,
        tokenizeMaxLineLength: PIERRE_MAX,
        overflow: 'wrap',
        // CodeView defaults this to true. We keep it false so changed-only files
        // collapse unchanged regions (separators + gap expanders); per-file "show
        // full file" is emulated by re-parsing into a single gap-free hunk.
        expandUnchanged: false,
        enableLineSelection: true,
        enableGutterUtility: true,
        controlledSelection: true,
        stickyHeaders: true,
        unsafeCSS: HOVER_UTILITY_UNSAFE_CSS,
      }),
      [inline],
    )

    return (
      <CodeView<DiffAnnotation[]>
        ref={ref}
        className={className}
        style={style}
        items={items}
        options={options}
        selectedLines={selectedLines}
        onSelectedLinesChange={onSelectionChange}
        renderAnnotation={renderAnnotation}
        renderHeaderMetadata={renderHeaderMetadata}
        renderGutterUtility={renderGutterUtility}
        onScroll={onScroll ? (scrollTop) => onScroll(scrollTop) : undefined}
      />
    )
  },
)
