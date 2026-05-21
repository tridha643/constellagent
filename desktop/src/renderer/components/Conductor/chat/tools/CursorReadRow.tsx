import { useCallback, type MouseEvent } from 'react'
import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { useAppStore } from '../../../../store/app-store'
import { isMarkdownDocumentPath } from '../../../../utils/markdown-path'
import { pathFromInput } from './InlineTools'
import { CursorReadDocIcon } from './CursorToolIcons'
import { CursorToolChip } from './CursorToolChip'
import { resolveToolFileAbsolutePath } from './tool-file-path'
import styles from './CursorTool.module.css'

function lineCount(output: unknown): number | undefined {
  if (typeof output !== 'string' || !output) return undefined
  return output.split('\n').length
}

export function CursorReadRow({ tool }: { tool: TimelineToolCall }) {
  const path = pathFromInput(tool.input)
  const lines = lineCount(tool.output)
  const label = lines ? `Read ${lines} line${lines === 1 ? '' : 's'}` : 'Read'

  const worktreePath = useAppStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    return ws?.worktreePath ?? null
  })
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)

  const openFile = useCallback(() => {
    if (!path || !worktreePath) return
    const absolute = resolveToolFileAbsolutePath(worktreePath, path)
    if (isMarkdownDocumentPath(absolute)) openMarkdownPreview(absolute)
    else openFileTab(absolute)
  }, [path, worktreePath, openFileTab, openMarkdownPreview])

  const onRowClick = (event: MouseEvent<HTMLButtonElement>) => {
    if ((event.target as HTMLElement).closest('[data-testid="diff-file-chip"]')) return
    openFile()
  }

  const onChipClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    openFile()
  }

  return (
    <div className={styles.cursorToolRow} data-testid="cursor-tool-row">
      <button type="button" className={styles.cursorToolRowMain} data-testid="cursor-read-row" onClick={onRowClick}>
        <span className={styles.cursorToolIcon} aria-hidden>
          <CursorReadDocIcon />
        </span>
        <span className={styles.cursorToolLabel}>{label}</span>
        {path ? <CursorToolChip variant="file" path={path} onClick={onChipClick} /> : null}
      </button>
    </div>
  )
}
