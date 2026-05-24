import { useCallback, useEffect, useState } from 'react'
import { Check, ExternalLink, RefreshCw, X } from 'lucide-react'
import type { AgentProvider } from '../../../../shared/agent-chat-types'
import styles from '../Conductor.module.css'

interface McpServerRow {
  name: string
  status: 'ok' | 'error' | 'unknown'
  detail?: string
}

function mcpDocsUrl(provider: AgentProvider): string {
  if (provider === 'cursor') return 'https://docs.cursor.com/context/mcp'
  if (provider === 'pi') return 'https://github.com/mariozechner/pi'
  return 'https://developers.openai.com/codex/mcp'
}

export function ConductorMcpStatusPanel({
  provider,
  workspacePath,
  onClose,
}: {
  provider: AgentProvider
  workspacePath: string
  onClose: () => void
}) {
  const [servers, setServers] = useState<McpServerRow[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.mcp.probeStatus(provider, workspacePath)
      setServers(result.servers)
    } finally {
      setLoading(false)
    }
  }, [provider, workspacePath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className={styles.conductorMcpPanel} data-testid="conductor-mcp-status-panel">
      <div className={styles.conductorMcpPanelHeader}>
        <div>
          <div className={styles.conductorMcpPanelTitle}>MCP status</div>
          <div className={styles.conductorMcpPanelSubtitle}>Refresh to check current server status.</div>
        </div>
        <button type="button" className={styles.conductorPanelClose} aria-label="Close" onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      <div className={styles.conductorMcpPanelBody}>
        {loading ? (
          <div className={styles.conductorMcpEmpty}>Checking MCP servers…</div>
        ) : servers.length === 0 ? (
          <div className={styles.conductorMcpEmpty}>No MCP servers configured yet.</div>
        ) : (
          servers.map((server) => (
            <div className={styles.conductorMcpServerRow} key={server.name}>
              <Check
                className={
                  server.status === 'error'
                    ? styles.conductorMcpServerIconError
                    : styles.conductorMcpServerIconOk
                }
                size={14}
                strokeWidth={2.4}
                aria-hidden
              />
              <span className={styles.conductorMcpServerName}>{server.name}</span>
            </div>
          ))
        )}
      </div>
      <div className={styles.conductorMcpPanelFooter}>
        <button type="button" className={styles.conductorMcpFooterBtn} onClick={() => void refresh()}>
          <RefreshCw size={14} strokeWidth={2} aria-hidden />
          Refresh status
        </button>
        <button
          type="button"
          className={styles.conductorMcpFooterBtn}
          onClick={() => void window.api.app.openExternal(mcpDocsUrl(provider))}
        >
          Read the MCP docs
          <ExternalLink size={14} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  )
}
