// First-class long-running service tab: status header + restart/stop wrapped around
// a normal TerminalPanel so the user sees `bun dev` etc. as a tab with controls.
import { useAppStore } from '../../store/app-store'
import { TerminalPanel } from '../Terminal/TerminalPanel'
import type { ServiceStatus } from '@shared/service-types'
import styles from './ServicePanel.module.css'

interface Props {
  tabId: string
  ptyId: string
  scriptName: string
  command: string
  status: ServiceStatus
  exitCode?: number
  active: boolean
}

function statusLabel(status: ServiceStatus): string {
  if (status === 'running') return 'Running'
  if (status === 'crashed') return 'Crashed'
  return 'Stopped'
}

export function ServicePanel({ tabId, ptyId, scriptName, command, status, exitCode, active }: Props) {
  const restartService = useAppStore((s) => s.restartService)
  const stopService = useAppStore((s) => s.stopService)
  const isRunning = status === 'running'

  return (
    <div className={styles.servicePanel} data-active={active} data-testid="service-panel">
      <div className={styles.header} data-testid="service-header">
        <span className={`${styles.statusDot} ${styles[`status-${status}`]}`} data-status={status} />
        <span className={styles.scriptName} data-testid="service-script-name">{scriptName}</span>
        <span className={styles.command} title={command}>{command}</span>
        <span className={styles.statusLabel} data-testid="service-status">{statusLabel(status)}</span>
        {!isRunning && typeof exitCode === 'number' ? (
          <span className={styles.exitCode} data-testid="service-exit-code">exit {exitCode}</span>
        ) : null}
        <div className={styles.spacer} />
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => void restartService(tabId)}
          data-testid="service-restart"
        >
          Restart
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => stopService(tabId)}
          disabled={!isRunning}
          data-testid="service-stop"
        >
          Stop
        </button>
      </div>
      <div className={styles.terminalArea}>
        <TerminalPanel ptyId={ptyId} active={active} />
      </div>
    </div>
  )
}
