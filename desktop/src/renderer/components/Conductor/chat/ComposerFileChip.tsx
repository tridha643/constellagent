import { useCallback } from 'react'
import { X } from 'lucide-react'
import type { ConductorFileMention } from '../../../../shared/composer-at-mention'
import { atMentionFileName } from '../../../../shared/composer-at-mention'
import { useAppStore } from '../../../store/app-store'
import { SharedFileIcon } from '../../../utils/file-presentation'
import { isMarkdownDocumentPath } from '../../../utils/markdown-path'
import styles from '../Conductor.module.css'

export function ComposerFileChip({
  mention,
  onRemove,
}: {
  mention: ConductorFileMention
  onRemove?: (id: string) => void
}) {
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const worktreePath = useAppStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    return ws?.worktreePath ?? null
  })
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)

  const label = atMentionFileName(mention.relativePath)

  const open = useCallback(() => {
    if (!worktreePath) return
    const absolute = mention.absolutePath
    if (isMarkdownDocumentPath(absolute)) openMarkdownPreview(absolute)
    else openFileTab(absolute)
  }, [worktreePath, mention.absolutePath, openFileTab, openMarkdownPreview])

  return (
    <span className={styles.composerFileChip} data-testid="composer-file-chip">
      <button
        type="button"
        className={styles.composerFileChipMain}
        title={mention.relativePath}
        aria-label={`Open ${mention.relativePath}`}
        onClick={open}
      >
        <span className={styles.composerFileChipIconWrap}>
          <SharedFileIcon
            path={mention.relativePath}
            appearanceThemeId={appearanceThemeId}
            className={styles.composerFileChipIcon}
          />
        </span>
        <span className={styles.composerFileChipDivider} aria-hidden />
        <span className={styles.composerFileChipLabel}>{label}</span>
      </button>
      {onRemove ? (
        <button
          type="button"
          className={styles.composerFileChipRemove}
          aria-label={`Remove ${label}`}
          onClick={() => onRemove(mention.id)}
        >
          <X size={12} strokeWidth={2} />
        </button>
      ) : null}
    </span>
  )
}
