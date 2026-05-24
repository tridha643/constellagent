import { useState, type MouseEvent } from 'react'
import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { MarkdownBody } from '../MarkdownBody'
import { CursorMutateDocIcon } from './CursorToolIcons'
import { CursorDiffChip } from './CursorDiffChip'
import { CursorDiffCode } from './CursorDiffCode'
import { CursorPlainStats, CursorToolRowShell } from './CursorToolChip'
import { diffActionVerb } from './diff-summary-label'
import { diffStatsFromPatch } from './diff-utils'
import { useWorktreeFilePatch } from './use-worktree-file-patch'
import styles from './CursorTool.module.css'

export function CursorDiffRow({
  path,
  patch: initialPatch,
  tool,
}: {
  path: string
  patch: string
  tool: TimelineToolCall
}) {
  const patch = useWorktreeFilePatch(path, initialPatch)
  const { additions, deletions } = diffStatsFromPatch(patch)
  const verb = diffActionVerb(tool.toolName, additions, deletions)
  const [unlocked, setUnlocked] = useState(false)

  const onRowClick = (event: MouseEvent<HTMLButtonElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('[data-testid="diff-file-chip"]')) return
    if (!patch.trim()) return
    setUnlocked((v) => !v)
  }

  return (
    <CursorToolRowShell
      testId="cursor-tool-row"
      unlocked={unlocked && patch.trim().length > 0}
      unlockedPanel={<CursorDiffCode patch={patch} />}
    >
      <div className={styles.cursorToolRowMain} data-testid="diff-inline-row">
        <button
          type="button"
          className={styles.cursorToolRowHit}
          onClick={onRowClick}
          aria-expanded={unlocked}
        >
          <span className={styles.cursorToolIcon} aria-hidden>
            <CursorMutateDocIcon />
          </span>
          <span className={styles.cursorToolLabel}>{verb}</span>
        </button>
        <CursorDiffChip path={path} patch={patch} />
        <CursorPlainStats additions={additions} deletions={deletions} />
      </div>
    </CursorToolRowShell>
  )
}

export function CursorDiffFallbackRow({ tool }: { tool: TimelineToolCall }) {
  return (
    <div className={styles.cursorToolRow} data-testid="cursor-tool-row">
      <div className={styles.cursorToolRowMain}>
        <span className={styles.cursorToolIcon} aria-hidden>
          <CursorMutateDocIcon />
        </span>
        <MarkdownBody content={tool.label} className={styles.cursorToolLabel} compact inline />
      </div>
    </div>
  )
}
