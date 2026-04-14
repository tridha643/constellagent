import type { ReactNode } from 'react'
import type { AgentType } from '../../store/types'
import styles from './ChatView.module.css'

const AGENT_LABELS: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  'pi-constell': 'PI Constell',
}

interface ChatViewProps {
  active: boolean
  title: string
  agentType?: AgentType
  workspaceName?: string
  branch?: string
  worktreePath?: string
  splitMode?: boolean
  children: ReactNode
}

function getAgentToneClass(agentType: AgentType | undefined): string {
  switch (agentType) {
    case 'claude-code':
      return styles.agentClaude
    case 'codex':
      return styles.agentCodex
    case 'gemini':
      return styles.agentGemini
    case 'cursor':
      return styles.agentCursor
    case 'opencode':
      return styles.agentOpencode
    case 'pi-constell':
      return styles.agentPi
    default:
      return styles.agentTerminal
  }
}

function getPathLeaf(path?: string): string | undefined {
  if (!path) return undefined
  const segments = path.split('/').filter(Boolean)
  return segments.at(-1)
}

function abbreviatePath(path?: string): string {
  if (!path) return 'Persistent PTY session'
  const segments = path.split('/').filter(Boolean)
  if (segments.length <= 3) return path
  return `…/${segments.slice(-3).join('/')}`
}

export function ChatView({
  active,
  title,
  agentType,
  workspaceName,
  branch,
  worktreePath,
  splitMode = false,
  children,
}: ChatViewProps) {
  const agentLabel = agentType ? AGENT_LABELS[agentType] : 'Terminal'
  const sessionTitle = title.trim() || agentLabel
  const pathLeaf = getPathLeaf(worktreePath) || 'Detached session'
  const subtitle = splitMode
    ? 'Persistent PTY panes inside a calmer shell, without losing the power-user split workflow.'
    : 'A centered terminal surface with preserved scrollback, focus, and drag-and-drop behavior.'

  return (
    <div className={`${styles.chatView} ${active ? styles.active : styles.hidden} ${splitMode ? styles.splitMode : ''}`}>
      <div className={styles.shell}>
        <div className={styles.column}>
          <div className={styles.header}>
            <div className={styles.headerMain}>
              <div className={styles.badges}>
                <span className={`${styles.agentBadge} ${getAgentToneClass(agentType)}`}>
                  {agentLabel}
                </span>
                {splitMode && <span className={styles.metaBadge}>Split panes</span>}
                {workspaceName && <span className={styles.metaBadge}>Workspace {workspaceName}</span>}
                {branch && <span className={styles.metaBadge}>Branch {branch}</span>}
              </div>

              <div className={styles.titleBlock}>
                <h1 className={styles.title}>{sessionTitle}</h1>
                <p className={styles.subtitle}>{subtitle}</p>
              </div>
            </div>

            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>working tree</span>
              <span className={styles.summaryValue}>{pathLeaf}</span>
              <span className={styles.summarySubvalue}>{abbreviatePath(worktreePath)}</span>
            </div>
          </div>

          <div className={styles.surface}>
            {children}
            {!splitMode && (
              <div className={styles.actionPill}>
                <span className={styles.actionLead}>Drop files to paste paths</span>
                <span className={styles.actionDivider} />
                <span className={styles.actionHint}>⌘T opens a new session</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
