import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../../../store/app-store'
import { getConductorChatTypographyStyle } from '../../../../theme/appearance'
import { SharedFileIcon } from '../../../../utils/file-presentation'
import { isMarkdownDocumentPath } from '../../../../utils/markdown-path'
import { resolveToolFileAbsolutePath, toolFileBasename } from './tool-file-path'
import { CursorDiffCode } from './CursorDiffCode'
import { CursorToolChip } from './CursorToolChip'
import { MAX_COMPACT_ROWS, parseDiffRows } from './diff-utils'
import { useMountTransition } from '../use-active-turn'
import styles from './CursorTool.module.css'

const SHOW_DELAY_MS = 140
const HIDE_DELAY_MS = 180
const POPOVER_TRANSITION_MS = 140
const POPOVER_WIDTH_PX = 360
const POPOVER_MAX_HEIGHT_PX = 320

function useDiffPopoverStyle(open: boolean, anchorRef: React.RefObject<HTMLButtonElement | null>): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined)

  useLayoutEffect(() => {
    if (!open) {
      setStyle(undefined)
      return
    }

    const update = (): void => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const pad = 8
      const width = Math.min(POPOVER_WIDTH_PX, window.innerWidth - pad * 2)
      let left = r.right - width
      left = Math.max(pad, Math.min(left, window.innerWidth - width - pad))

      const gap = 8
      const spaceBelow = window.innerHeight - r.bottom - gap
      const spaceAbove = r.top - gap
      const placeAbove = spaceBelow < 180 && spaceAbove > spaceBelow

      if (placeAbove) {
        setStyle({
          position: 'fixed',
          left,
          top: r.top - gap,
          width,
          maxHeight: Math.min(POPOVER_MAX_HEIGHT_PX, spaceAbove),
          transform: 'translateY(-100%)',
          zIndex: 100_000,
        })
      } else {
        setStyle({
          position: 'fixed',
          left,
          top: r.bottom + gap,
          width,
          maxHeight: Math.min(POPOVER_MAX_HEIGHT_PX, spaceBelow),
          zIndex: 100_000,
        })
      }
    }

    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, anchorRef])

  return style
}

/** Bordered file chip; hover shows borderless diff popover with icon + filename header. */
const conductorTypographyStyle = getConductorChatTypographyStyle()

export function CursorDiffChip({ path, patch }: { path: string; patch: string }) {
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const worktreePath = useAppStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    return ws?.worktreePath ?? null
  })
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)

  const chipRef = useRef<HTMLButtonElement | null>(null)
  const [hoverOpen, setHoverOpen] = useState(false)
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const { shouldRender: showPopover, phase } = useMountTransition(hoverOpen, POPOVER_TRANSITION_MS)
  const popoverStyle = useDiffPopoverStyle(hoverOpen, chipRef)

  const { rows } = useMemo(
    () => parseDiffRows(patch, { maxRows: MAX_COMPACT_ROWS, tokenizeModifiedRows: false }),
    [patch],
  )
  const hasPreview = patch.trim().length > 0

  const clearTimers = useCallback(() => {
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
  }, [])

  const openPreview = useCallback(() => {
    if (!hasPreview) return
    clearTimers()
    showTimer.current = setTimeout(() => setHoverOpen(true), SHOW_DELAY_MS)
  }, [clearTimers, hasPreview])

  const closePreview = useCallback(() => {
    clearTimers()
    hideTimer.current = setTimeout(() => setHoverOpen(false), HIDE_DELAY_MS)
  }, [clearTimers])

  const cancelClose = useCallback(() => {
    clearTimeout(hideTimer.current)
    setHoverOpen(true)
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  const openFile = useCallback(() => {
    if (!worktreePath) return
    const absolute = resolveToolFileAbsolutePath(worktreePath, path)
    if (isMarkdownDocumentPath(absolute)) openMarkdownPreview(absolute)
    else openFileTab(absolute)
  }, [worktreePath, path, openFileTab, openMarkdownPreview])

  const onChipClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    openFile()
  }

  const basename = toolFileBasename(path)

  return (
    <>
      <CursorToolChip
        variant="file"
        path={path}
        chipRef={chipRef}
        onClick={onChipClick}
        onMouseEnter={openPreview}
        onMouseLeave={closePreview}
        onFocus={openPreview}
        onBlur={closePreview}
      />
      {hasPreview && showPopover && popoverStyle
        ? createPortal(
            <div
              className={styles.cursorDiffPopover}
              data-state={phase}
              style={{ ...conductorTypographyStyle, ...popoverStyle }}
              data-testid="conductor-diff-hover-popover"
              onMouseEnter={cancelClose}
              onMouseLeave={closePreview}
            >
              <div className={styles.cursorDiffPopoverHeader} data-testid="cursor-diff-popover-header">
                <SharedFileIcon
                  path={path}
                  appearanceThemeId={appearanceThemeId}
                  className={styles.cursorDiffPopoverHeaderIcon}
                />
                <span>{basename}</span>
              </div>
              <div className={styles.cursorDiffPopoverBody}>
                {rows.length > 0 ? (
                  <CursorDiffCode patch={patch} />
                ) : (
                  <pre className={styles.cursorDiffPopoverFallback}>{patch.trim()}</pre>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
