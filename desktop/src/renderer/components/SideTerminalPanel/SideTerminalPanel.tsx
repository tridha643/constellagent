import { useEffect, useMemo, useRef } from 'react'
import { Plus, RotateCcw, TerminalSquare, Unlink, X } from 'lucide-react'
import { TerminalPanel } from '../Terminal/TerminalPanel'
import { Tooltip } from '../Tooltip/Tooltip'
import { useAppStore } from '../../store/app-store'
import type { SideTerminalSession } from '../../store/types'
import styles from './SideTerminalPanel.module.css'

interface Props {
  workspaceId: string
}

/** Stable fallback — `?? []` in a Zustand selector creates a new array every snapshot and loops. */
const EMPTY_SIDE_TERMINAL_SESSIONS: readonly SideTerminalSession[] = []

/** A session is "live" only when its client PTY is attached and healthy. */
function isAttached(session: SideTerminalSession): boolean {
  return Boolean(session.clientPtyId) && session.status === 'attached'
}

export function SideTerminalPanel({ workspaceId }: Props) {
  const sessions = useAppStore(
    (s) => s.sideTerminalsByWorkspace[workspaceId] ?? EMPTY_SIDE_TERMINAL_SESSIONS,
  )
  const createSideTerminalForActiveWorkspace = useAppStore((s) => s.createSideTerminalForActiveWorkspace)
  const attachSideTerminal = useAppStore((s) => s.attachSideTerminal)
  const detachSideTerminal = useAppStore((s) => s.detachSideTerminal)
  const killSideTerminalSession = useAppStore((s) => s.killSideTerminalSession)
  const reconcileSideTerminalsForWorkspace = useAppStore((s) => s.reconcileSideTerminalsForWorkspace)

  const activeSession = useMemo(() => {
    return [...sessions].sort((a, b) => (b.lastAttachedAt ?? b.createdAt) - (a.lastAttachedAt ?? a.createdAt))[0]
  }, [sessions])

  useEffect(() => {
    void reconcileSideTerminalsForWorkspace(workspaceId)
  }, [reconcileSideTerminalsForWorkspace, workspaceId])

  // Detach the live client PTY only when the panel truly goes away (unmount or
  // workspace switch) — never on every `activeSession` change. Reading the
  // latest session through a ref keeps this effect off the render-driven
  // attach/detach state churn that otherwise loops `setState` indefinitely.
  const activeSessionRef = useRef(activeSession)
  activeSessionRef.current = activeSession
  useEffect(() => {
    return () => {
      const session = activeSessionRef.current
      if (session?.clientPtyId) {
        useAppStore.getState().detachSideTerminal(workspaceId, session.id)
      }
    }
  }, [workspaceId])

  return (
    <div className={styles.panel} data-testid="side-terminal-panel">
      {sessions.length > 0 && (
        <div className={styles.rail} data-testid="side-terminal-rail">
          <div className={styles.sessionList}>
            {sessions.map((session) => {
              const selected = session.id === activeSession?.id
              const live = isAttached(session)
              return (
                <div
                  key={session.id}
                  className={`${styles.sessionTab} ${selected ? styles.sessionTabActive : ''}`}
                  data-testid="side-terminal-session-tab"
                  data-active={selected ? 'true' : 'false'}
                >
                  <button
                    type="button"
                    className={styles.sessionTabMain}
                    aria-pressed={selected}
                    title={session.title}
                    onClick={() => void attachSideTerminal(workspaceId, session.id)}
                  >
                    <TerminalSquare size={13} strokeWidth={2} className={styles.sessionTabIcon} />
                    <span className={styles.sessionTitle}>{session.title}</span>
                    {!live && (
                      <span
                        className={styles.sessionDot}
                        aria-hidden="true"
                        data-status={session.status}
                      />
                    )}
                  </button>
                  {/* Close = gone: terminate the underlying tmux session so it
                      can't be resurrected on the next workspace switch. Use
                      Detach to leave a process running in the background. */}
                  <button
                    type="button"
                    className={styles.sessionClose}
                    aria-label={`Close ${session.title}`}
                    title={`Close ${session.title}`}
                    data-testid="side-terminal-close"
                    onClick={() => void killSideTerminalSession(workspaceId, session.id)}
                  >
                    <X size={11} strokeWidth={2.25} />
                  </button>
                  <span className={styles.sessionUnderline} aria-hidden="true" />
                </div>
              )
            })}
          </div>

          <div className={styles.railActions}>
            <Tooltip label="New terminal">
              <button
                type="button"
                className={styles.iconButton}
                data-testid="side-terminal-new"
                onClick={() => void createSideTerminalForActiveWorkspace()}
              >
                <Plus size={14} strokeWidth={2} />
              </button>
            </Tooltip>
            {activeSession && isAttached(activeSession) && (
              <Tooltip label="Detach (leave running in background)">
                <button
                  type="button"
                  className={styles.iconButton}
                  data-testid="side-terminal-detach"
                  onClick={() => detachSideTerminal(workspaceId, activeSession.id)}
                >
                  <Unlink size={14} strokeWidth={2} />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      )}

      <div className={styles.viewport}>
        {activeSession?.clientPtyId ? (
          <TerminalPanel
            key={activeSession.clientPtyId}
            ptyId={activeSession.clientPtyId}
            active
            scrollbackKey={`side-${activeSession.id}`}
          />
        ) : (
          <div className={styles.emptyState}>
            <TerminalSquare size={26} strokeWidth={1.6} className={styles.emptyIcon} />
            <div className={styles.emptyTitle}>
              {sessions.length === 0 ? 'No terminal sessions' : 'Session detached'}
            </div>
            <div className={styles.emptyActions}>
              {activeSession ? (
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void attachSideTerminal(workspaceId, activeSession.id)}
                >
                  <RotateCcw size={14} strokeWidth={2} />
                  Reattach
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void createSideTerminalForActiveWorkspace()}
                >
                  <Plus size={14} strokeWidth={2} />
                  New terminal
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
