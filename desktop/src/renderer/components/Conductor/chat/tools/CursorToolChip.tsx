import type { MouseEvent, ReactNode, RefObject } from 'react'
import { useAppStore } from '../../../../store/app-store'
import { SharedFileIcon } from '../../../../utils/file-presentation'
import { toolFileBasename } from './tool-file-path'
import styles from './CursorTool.module.css'

type ChipVariant = 'file' | 'directory' | 'command'

function chipClass(variant: ChipVariant): string {
  if (variant === 'directory') {
    return `${styles.cursorToolChip} ${styles['cursorToolChip--directory']}`
  }
  return `${styles.cursorToolChip} ${styles['cursorToolChip--bordered']}`
}

export function CursorToolChip({
  variant,
  path,
  command,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  chipRef,
  testId = 'diff-file-chip',
}: {
  variant: ChipVariant
  path?: string
  command?: string
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  onFocus?: () => void
  onBlur?: () => void
  chipRef?: RefObject<HTMLButtonElement | null>
  testId?: string
}) {
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)

  const label =
    variant === 'command'
      ? (command ?? '').trim()
      : variant === 'directory'
        ? (path ?? '').replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() || path || ''
        : path
          ? toolFileBasename(path)
          : ''

  const title = variant === 'command' ? command : path

  if (variant === 'directory') {
    return (
      <span className={chipClass('directory')} data-testid="cursor-dir-chip" title={path}>
        <span className={styles.cursorToolChipLabel}>{label}</span>
      </span>
    )
  }

  return (
    <button
      ref={chipRef}
      type="button"
      className={chipClass(variant)}
      title={title}
      aria-label={variant === 'command' ? command : path ? `Open ${path}` : undefined}
      data-testid={testId}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {variant === 'file' && path ? (
        <SharedFileIcon path={path} appearanceThemeId={appearanceThemeId} className={styles.cursorToolChipIcon} />
      ) : null}
      <span className={styles.cursorToolChipLabel}>{label}</span>
    </button>
  )
}

export function CursorPlainStats({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions <= 0 && deletions <= 0) return null
  return (
    <span className={styles.cursorToolStats} data-testid="cursor-diff-stats">
      {additions > 0 ? (
        <span className={styles.cursorToolStatAdd} data-testid="cursor-diff-stat-add">
          +{additions}
        </span>
      ) : null}
      {deletions > 0 ? (
        <span className={styles.cursorToolStatDel} data-testid="cursor-diff-stat-del">
          −{deletions}
        </span>
      ) : null}
    </span>
  )
}

export function CursorToolRowShell({
  children,
  unlocked,
  unlockedPanel,
  testId = 'cursor-tool-row',
}: {
  children: ReactNode
  unlocked?: boolean
  unlockedPanel?: ReactNode
  testId?: string
}) {
  return (
    <div className={styles.cursorToolRow} data-testid={testId}>
      {children}
      {unlocked && unlockedPanel ? (
        <div className={styles.cursorDiffUnlocked} data-testid="cursor-diff-unlocked">
          {unlockedPanel}
        </div>
      ) : null}
    </div>
  )
}
