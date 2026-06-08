import styles from '../Editor/AnnotationBubble.module.css'

/** Stage (Keep ⌘Y) / Discard (Undo ⌘N) bar injected at a hunk's start line. */
export function HunkActionAnnotation({
  hunkIndex,
  onAccept,
  onReject,
  disabled = false,
}: {
  hunkIndex: number
  onAccept: (hunkIndex: number) => void
  onReject: (hunkIndex: number) => void
  disabled?: boolean
}) {
  return (
    <div className={styles.hunkActionBar}>
      <div className={styles.hunkActionGroup}>
        <button
          type="button"
          aria-label="Discard hunk"
          disabled={disabled}
          onClick={() => onReject(hunkIndex)}
          className={styles.hunkActionUndo}
        >
          Discard <kbd className={styles.kbd}>&#8984;N</kbd>
        </button>
        <button
          type="button"
          aria-label="Stage hunk"
          disabled={disabled}
          onClick={() => onAccept(hunkIndex)}
          className={styles.hunkActionKeep}
        >
          Stage <kbd className={styles.kbd}>&#8984;Y</kbd>
        </button>
      </div>
    </div>
  )
}
