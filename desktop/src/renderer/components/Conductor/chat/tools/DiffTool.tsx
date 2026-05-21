import { Collapsible } from '@base-ui-components/react/collapsible'
import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { useAppStore } from '../../../../store/app-store'
import { SharedFileIcon } from '../../../../utils/file-presentation'
import { FilePathChip } from '../FilePathChip'
import { ChevronDownIcon, EditIcon } from '../ConductorIcons'
import { diffPatchMarkdown, MarkdownBody } from '../MarkdownBody'
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
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const { rows, additions, deletions, hasNoNewline } = parseDiffRows(patch)
  const changed = additions + deletions
  const display = normalizePath(path)
  const markdown = diffPatchMarkdown(patch, hasNoNewline)

  return (
    <Collapsible.Root defaultOpen={changed <= COLLAPSE_THRESHOLD} className={styles.diffCard}>
      <div className={styles.diffHeader}>
        <Collapsible.Trigger className={styles.diffHeaderTrigger}>
          <span className={styles.collapsibleChevron}>
            <ChevronDownIcon size={12} />
          </span>
          <EditIcon size={13} />
          {!navigable ? (
            <>
              <SharedFileIcon path={path} appearanceThemeId={appearanceThemeId} className={styles.diffFileIcon} />
              <span className={styles.diffPath}>{display}</span>
            </>
          ) : null}
          <span className={styles.diffCounts}>
            {additions > 0 && <span className={styles.diffCountAdd}>+{additions}</span>}
            {deletions > 0 && <span className={styles.diffCountDel}>−{deletions}</span>}
          </span>
        </Collapsible.Trigger>
        {navigable ? <FilePathChip path={path} /> : null}
      </div>
      <Collapsible.Panel className={styles.collapsiblePanel}>
        <MarkdownBody
          content={rows.length > 0 ? markdown : diffPatchMarkdown('')}
          className={styles.diffBody}
          compact
        />
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

/** Renders git-reconstructed patches as a fenced ```diff block via ProseMark. */
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
