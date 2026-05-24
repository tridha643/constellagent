import { Terminal, X } from 'lucide-react'
import styles from '../Conductor.module.css'

export function ConductorMcpTerminalBanner({
  onOpenTerminal,
  onClose,
}: {
  onOpenTerminal: () => void
  onClose: () => void
}) {
  return (
    <div className={styles.conductorMcpBanner} data-testid="conductor-mcp-banner">
      <span className={styles.conductorMcpBannerText}>Run /mcp in the embedded terminal</span>
      <div className={styles.conductorMcpBannerActions}>
        <button type="button" className={styles.conductorMcpBannerOpen} onClick={onOpenTerminal}>
          <Terminal size={14} strokeWidth={2} aria-hidden />
          Open terminal
        </button>
        <button type="button" className={styles.conductorPanelClose} aria-label="Close" onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
