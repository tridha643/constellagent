import { STATUS_LABELS } from '@shared/status-labels'
import type { DiffFileData } from '../../types/working-tree-diff'
import styles from '../Editor/Editor.module.css'

/**
 * Raw `<pre>` fallback for combined-merge (`diff --cc` / `@@@`) patches that
 * CodeView can't parse. Rendered outside the single CodeView container, after the
 * virtualized files, with the same explanatory note the retired surface used.
 */
export function CombinedMergeFallback({
  files,
  worktreePath,
  onOpenFile,
}: {
  files: DiffFileData[]
  worktreePath: string
  onOpenFile: (fullPath: string) => void
}) {
  if (files.length === 0) return null
  return (
    <div className={styles.diffScrollContent}>
      {files.map((file) => {
        const parts = file.filePath.split('/')
        const fileName = parts.pop()
        const dir = parts.length > 0 ? parts.join('/') + '/' : ''
        const fullPath = file.filePath.startsWith('/') ? file.filePath : `${worktreePath}/${file.filePath}`
        return (
          <div key={file.filePath} className={styles.diffFileSection} id={`diff-${file.filePath}`}>
            <div className={styles.expandedFileBody}>
              <div
                className={styles.fileHeader}
                role="button"
                tabIndex={0}
                onClick={() => onOpenFile(fullPath)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpenFile(fullPath)
                  }
                }}
              >
                <span className={`${styles.fileHeaderBadge} ${styles[file.status] || ''}`}>
                  {STATUS_LABELS[file.status] || '?'}
                </span>
                <span className={styles.fileHeaderPath}>
                  {dir && <span className={styles.fileHeaderDir}>{dir}</span>}
                  {fileName}
                </span>
              </div>
              <p className={styles.combinedDiffNote}>
                Merge commit: combined diff (<code className={styles.combinedDiffCode}>diff --cc</code> /{' '}
                <code className={styles.combinedDiffCode}>@@@</code>) — showing raw patch. The rich diff viewer
                only supports unified <code className={styles.combinedDiffCode}>diff --git</code> format.
              </p>
              <pre className={styles.rawMergePatch}>{file.patch}</pre>
            </div>
          </div>
        )
      })}
    </div>
  )
}
