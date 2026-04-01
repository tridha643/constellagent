import type { OrchestratorSession } from '../../../shared/orchestrator-types'
import styles from './OrchestratorPanel.module.css'

const STATUS_CLASS: Record<OrchestratorSession['status'], string> = {
  pending: styles.sessionPending,
  running: styles.sessionRunning,
  done: styles.sessionDone,
  failed: styles.sessionFailed,
}

export function WorktreeMap({ sessions }: { sessions: OrchestratorSession[] }) {
  if (sessions.length === 0) {
    return (
      <div className={styles.sessionColumn}>
        <div className={styles.sessionTitle}>Worktree Sessions</div>
        <div className={styles.sessionList}>
          <div className={styles.emptyState}>No active sessions</div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.sessionColumn}>
      <div className={styles.sessionTitle}>Worktree Sessions ({sessions.length})</div>
      <div className={styles.sessionList}>
        {sessions.map((session) => (
          <div key={session.id} className={styles.sessionCard}>
            <div className={styles.sessionBranch}>{session.branch}</div>
            <div className={styles.sessionTask}>{session.task}</div>
            <span className={`${styles.sessionStatus} ${STATUS_CLASS[session.status]}`}>
              {session.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
