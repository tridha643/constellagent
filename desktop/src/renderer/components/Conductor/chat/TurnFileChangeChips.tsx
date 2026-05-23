import type { ToolFileChange } from './tools/tool-file-change'
import { DiffFilePathChip } from './tools/DiffFilePathChip'
import { DiffLineStats } from './tools/DiffLineStats'
import { diffStatsFromPatch } from './tools/diff-utils'
import styles from '../Conductor.module.css'

export function TurnFileChangeChips({
  changes,
  compact = false,
}: {
  changes: readonly ToolFileChange[]
  compact?: boolean
}) {
  if (changes.length === 0) return null

  return (
    <div
      className={[
        styles.turnFileChips,
        compact ? styles.turnFileChipsCompact : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={compact ? 'turn-summary-file-chips' : 'turn-file-chips'}
    >
      {changes.map((file) => {
        const { additions, deletions } = diffStatsFromPatch(file.patch)
        return (
          <div className={styles.turnFileChipRow} key={`${file.operation}:${file.path}`}>
            <DiffFilePathChip path={file.path} patch={file.patch} />
            <DiffLineStats additions={additions} deletions={deletions} />
          </div>
        )
      })}
    </div>
  )
}
