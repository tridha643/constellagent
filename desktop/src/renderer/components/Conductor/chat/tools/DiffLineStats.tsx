import styles from '../../Conductor.module.css'

/** Compact +N / −M counts for collapsed edit chip headers. */
export function DiffLineStats({
  additions,
  deletions,
}: {
  additions: number
  deletions: number
}) {
  if (additions <= 0 && deletions <= 0) return null
  return (
    <span className={styles.diffCounts}>
      {additions > 0 ? <span className={styles.diffCountAdd}>+{additions}</span> : null}
      {deletions > 0 ? <span className={styles.diffCountDel}>−{deletions}</span> : null}
    </span>
  )
}
