import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../../store/app-store'
import { Tooltip } from '../Tooltip/Tooltip'
import { MessageThread } from './MessageThread'
import { WorktreeMap } from './WorktreeMap'
import styles from './OrchestratorPanel.module.css'

const STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  running: 'Running',
  error: 'Error',
}

const STATUS_CLASS: Record<string, string> = {
  idle: styles.statusIdle,
  running: styles.statusRunning,
  error: styles.statusError,
}

export function OrchestratorPanel() {
  const toggleOrchestrator = useAppStore((s) => s.toggleOrchestrator)
  const orchestratorStatus = useAppStore((s) => s.orchestratorStatus)
  const orchestratorMessages = useAppStore((s) => s.orchestratorMessages)
  const orchestratorSessions = useAppStore((s) => s.orchestratorSessions)
  const setOrchestratorStatus = useAppStore((s) => s.setOrchestratorStatus)
  const addOrchestratorMessage = useAppStore((s) => s.addOrchestratorMessage)
  const updateOrchestratorSession = useAppStore((s) => s.updateOrchestratorSession)
  const settings = useAppStore((s) => s.settings)

  const [command, setCommand] = useState('')
  const [sending, setSending] = useState(false)
  const [started, setStarted] = useState(false)

  // Listen for IPC events from main process
  useEffect(() => {
    const unsubs = [
      window.api.orchestrator.onStatusChanged((status) => {
        setOrchestratorStatus(status)
      }),
      window.api.orchestrator.onSessionUpdated((session) => {
        updateOrchestratorSession(session)
      }),
      window.api.orchestrator.onMessageReceived((msg) => {
        addOrchestratorMessage(msg)
      }),
    ]
    return () => { unsubs.forEach((fn) => fn()) }
  }, [setOrchestratorStatus, updateOrchestratorSession, addOrchestratorMessage])

  // Load initial state
  useEffect(() => {
    window.api.orchestrator.getStatus().then(setOrchestratorStatus).catch(() => {})
  }, [setOrchestratorStatus])

  const handleStart = useCallback(async () => {
    try {
      await window.api.orchestrator.start(settings)
      setStarted(true)
    } catch (err) {
      console.error('Failed to start orchestrator:', err)
    }
  }, [settings])

  const handleStop = useCallback(async () => {
    try {
      await window.api.orchestrator.stop()
      setStarted(false)
    } catch (err) {
      console.error('Failed to stop orchestrator:', err)
    }
  }, [])

  const handleSendCommand = useCallback(async () => {
    if (!command.trim()) return
    setSending(true)
    try {
      await window.api.orchestrator.sendCommand(command.trim())
      setCommand('')
    } catch (err) {
      console.error('Failed to send command:', err)
    } finally {
      setSending(false)
    }
  }, [command])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSendCommand()
      }
    },
    [handleSendCommand],
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleOrchestrator()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleOrchestrator])

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerLeft}>
            <Tooltip label="Back">
              <button className={styles.backBtn} onClick={toggleOrchestrator}>
                &#8249;
              </button>
            </Tooltip>
            <h2 className={styles.title}>Orchestrator</h2>
            <span className={`${styles.statusBadge} ${STATUS_CLASS[orchestratorStatus]}`}>
              <span className={styles.statusDot} />
              {STATUS_LABEL[orchestratorStatus]}
            </span>
          </div>
          <div className={styles.headerActions}>
            {started ? (
              <button className={styles.actionBtnDanger} onClick={handleStop}>
                Stop
              </button>
            ) : (
              <button
                className={styles.actionBtn}
                onClick={handleStart}
                disabled={!settings.sendblueApiKey}
              >
                Start
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.contentInner}>
          <div className={styles.messageColumn}>
            <MessageThread messages={orchestratorMessages} />
            <div className={styles.commandInput}>
              <textarea
                className={styles.commandTextarea}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Send a command to the orchestrator..."
                rows={1}
              />
              <button
                className={styles.sendBtn}
                onClick={handleSendCommand}
                disabled={sending || !command.trim()}
              >
                {sending ? '...' : 'Send'}
              </button>
            </div>
          </div>
          <WorktreeMap sessions={orchestratorSessions} />
        </div>
      </div>
    </div>
  )
}
