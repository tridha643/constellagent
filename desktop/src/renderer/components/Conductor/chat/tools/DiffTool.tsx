import { Collapsible } from '@base-ui-components/react/collapsible'
import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { FilePathChip } from '../FilePathChip'
import { ChevronDownIcon, EditIcon } from '../ConductorIcons'
import { MarkdownBody } from '../MarkdownBody'
import { ConductorPierreDiff } from './ConductorPierreDiff'
import { DiffLineStats } from './DiffLineStats'
import { asFileChangeOutput, normalizePath, parseDiffRows } from './diff-utils'
import { isWriteToolName } from './tool-file-path'
import styles from '../../Conductor.module.css'

const COLLAPSE_THRESHOLD = 30

function FileDiffCard({
  path,
  patch,
  navigable,
}: {
  path: string
  patch: string
  navigable?: boolean
}) {
  const { additions, deletions } = parseDiffRows(patch)
  const changed = additions + deletions
  const display = normalizePath(path)

  return (
    <Collapsible.Root defaultOpen={changed <= COLLAPSE_THRESHOLD} className={styles.diffCard}>
      <div className={styles.diffHeader}>
        <Collapsible.Trigger className={styles.diffHeaderTrigger}>
          <span className={styles.collapsibleChevron}>
            <ChevronDownIcon size={12} />
          </span>
          <EditIcon size={13} />
          {!navigable ? <span className={styles.diffPath}>{display}</span> : null}
        </Collapsible.Trigger>
        {navigable ? <FilePathChip path={path} /> : null}
        <DiffLineStats additions={additions} deletions={deletions} />
      </div>
      <Collapsible.Panel className={styles.collapsiblePanel}>
        <div className={styles.diffBody}>
          <ConductorPierreDiff patch={patch} />
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

/** Renders git-reconstructed patches as Pierre unified diffs. */
export function DiffTool({ tool }: { tool: TimelineToolCall }) {
  const navigable = isWriteToolName(tool.toolName)
  const fileChange = asFileChangeOutput(tool.output)
  if (!fileChange || fileChange.files.length === 0) {
    return (
      <div className={styles.diffCard}>
        <div className={styles.diffHeader}>
          <EditIcon size={13} />
          <MarkdownBody content={tool.label} className={styles.diffFallbackLabel} inline compact />
        </div>
      </div>
    )
  }
  return (
    <div className={styles.diffStack}>
      {fileChange.files.map((file) => (
        <FileDiffCard key={file.path} path={file.path} patch={file.patch} navigable={navigable} />
      ))}
    </div>
  )
}
