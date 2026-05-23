import styles from '../../Conductor.module.css'

/** +N / −M badges for file-change card headers. */
export function DiffLineStats({
  additions,
  deletions,
}: {
  additions: number
  deletions: number
}) {
  if (additions <= 0 && deletions <= 0) return null
  return (
    <span className={styles.diffCounts} data-testid="conductor-diff-stats">
      {additions > 0 ? (
        <span className={styles.diffStatBadgeAdd} data-testid="conductor-diff-count-add">
          <span className={styles.diffCountAdd}>+{additions}</span>
        </span>
      ) : null}
      {deletions > 0 ? (
        <span className={styles.diffStatBadgeDel} data-testid="conductor-diff-count-del">
          <span className={styles.diffCountDel}>−{deletions}</span>
        </span>
      ) : null}
    </span>
  )
}
