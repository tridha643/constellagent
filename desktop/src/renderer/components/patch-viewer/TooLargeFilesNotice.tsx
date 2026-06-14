import type { DiffFileData } from '../../types/working-tree-diff'
import editorStyles from '../Editor/Editor.module.css'

/**
 * Click-to-load placeholder for files whose diff exceeded the per-file byte
 * ceiling. Mirrors VS Code's `diffEditor.maxFileSize` behaviour: skip the
 * expensive render by default, load on explicit request.
 */
export function TooLargeFilesNotice({
  files,
  onLoad,
}: {
  files: DiffFileData[]
  onLoad: (filePath: string) => void
}) {
  if (files.length === 0) return null
  return (
    <div
      style={{
        flex: 'none',
        borderTop: '1px solid var(--border-subtle, rgba(127,127,127,0.18))',
        padding: '6px 12px',
      }}
    >
      {files.map((file) => (
        <div
          key={file.filePath}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '4px 0',
          }}
        >
          <span
            title={file.filePath}
            style={{
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              fontSize: 12,
              opacity: 0.8,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {file.filePath} — file too large to preview
          </span>
          <button
            type="button"
            className={editorStyles.diffReviewButton}
            onClick={() => onLoad(file.filePath)}
          >
            Load anyway
          </button>
        </div>
      ))}
    </div>
  )
}
