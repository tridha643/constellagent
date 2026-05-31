import { useCallback } from 'react'
import { useAppStore } from '../../../store/app-store'
import { SharedFileIcon } from '../../../utils/file-presentation'
import { isMarkdownDocumentPath } from '../../../utils/markdown-path'
import { atMentionFileName } from '../../../../shared/composer-at-mention'
import { resolveToolFileAbsolutePath, toolFileBasename } from './tools/tool-file-path'
import styles from '../Conductor.module.css'

/** Clickable file pill with a language icon — opens the file in the editor. */
export function FilePathChip({ path }: { path: string }) {
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const worktreePath = useAppStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    return ws?.worktreePath ?? null
  })
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)

  const open = useCallback(() => {
    if (!worktreePath) return
    const absolute = resolveToolFileAbsolutePath(worktreePath, path)
    if (isMarkdownDocumentPath(absolute)) openMarkdownPreview(absolute)
    else openFileTab(absolute)
  }, [worktreePath, path, openFileTab, openMarkdownPreview])

  const label = atMentionFileName(path.replace(/^@/, '')) || toolFileBasename(path)

  return (
    <button
      type="button"
      className={styles.toolInlineChip}
      title={path}
      aria-label={`Open ${path}`}
      onClick={(event) => {
        event.stopPropagation()
        open()
      }}
    >
      <SharedFileIcon path={path} appearanceThemeId={appearanceThemeId} className={styles.toolInlineChipIcon} />
      <span className={styles.toolInlineChipLabel}>{label}</span>
    </button>
  )
}
