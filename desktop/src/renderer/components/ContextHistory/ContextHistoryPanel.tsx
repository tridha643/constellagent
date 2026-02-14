import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../../store/app-store'
import { Tooltip } from '../Tooltip/Tooltip'
import styles from './ContextHistoryPanel.module.css'

interface ContextEntry {
  id: number
  workspaceId?: string
  toolName: string
  toolInput: string
  filePath: string | null
  agentType: string
  projectHead: string | null
  eventType: string | null
  toolResponse: string | null
  timestamp: string
}

const AGENT_DOT_CLASS: Record<string, string> = {
  'claude-code': styles.dotBlue,
  codex: styles.dotGreen,
  gemini: styles.dotOrange,
  cursor: styles.dotPurple,
}

const AGENT_LABEL: Record<string, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  cursor: 'Cursor',
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ts
  }
}

const TOOL_DISPLAY: Record<string, { label: string; icon: string }> = {
  UserPrompt: { label: 'You', icon: '›' },
  AssistantTurn: { label: 'Assistant', icon: '‹' },
  Write: { label: 'Write', icon: '✎' },
  Edit: { label: 'Edit', icon: '✎' },
  MultiEdit: { label: 'Multi-Edit', icon: '✎' },
  Read: { label: 'Read', icon: '◉' },
  Bash: { label: 'Shell', icon: '$' },
  Execute: { label: 'Execute', icon: '$' },
  Glob: { label: 'Glob', icon: '⌕' },
  Grep: { label: 'Search', icon: '⌕' },
  TodoWrite: { label: 'Todo', icon: '☐' },
  Task: { label: 'Task', icon: '⊞' },
  WebFetch: { label: 'Fetch', icon: '↗' },
  WebSearch: { label: 'Search', icon: '↗' },
  // Session lifecycle events
  SessionStart: { label: 'Session Start', icon: '▶' },
  SessionEnd: { label: 'Session End', icon: '■' },
  SubagentStart: { label: 'Subagent Start', icon: '▸' },
  SubagentStop: { label: 'Subagent Stop', icon: '▪' },
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  PreToolUse: 'pre',
  PostToolUse: 'post',
  PostToolUseFailure: 'failed',
  BeforeAgent: 'before',
  AfterAgent: 'after',
  AfterTool: 'after',
  beforeSubmitPrompt: 'prompt',
  afterFileEdit: 'edit',
  beforeShellExecution: 'shell',
  beforeMCPExecution: 'mcp',
  stop: 'stop',
}

function formatToolInput(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    // Show the most useful field from common tool inputs
    if (typeof parsed === 'object' && parsed !== null) {
      const summary =
        parsed.command ?? parsed.query ?? parsed.content ?? parsed.description ?? parsed.message
      if (typeof summary === 'string') {
        return summary.length > 100 ? summary.slice(0, 100) + '...' : summary
      }
    }
  } catch { /* not JSON, fall through */ }
  return raw.length > 100 ? raw.slice(0, 100) + '...' : raw
}

function EntryRow({
  entry,
  onRestore,
}: {
  entry: ContextEntry
  onRestore?: (head: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const dotClass = AGENT_DOT_CLASS[entry.agentType] ?? styles.dotGray
  const display = TOOL_DISPLAY[entry.toolName]
  const eventLabel = entry.eventType ? EVENT_TYPE_LABELS[entry.eventType] ?? entry.eventType : null
  const formattedInput = formatToolInput(entry.toolInput)

  return (
    <div
      className={`${styles.entryRow} ${expanded ? styles.entryRowExpanded : ''}`}
      onClick={() => (entry.toolInput || entry.toolResponse) && setExpanded(!expanded)}
      style={{ cursor: entry.toolInput || entry.toolResponse ? 'pointer' : 'default' }}
    >
      <span className={`${styles.statusDot} ${dotClass}`} />
      <div className={styles.entryInfo}>
        <div className={styles.entryHeader}>
          <span className={styles.entryToolName}>
            {display ? (
              <><span className={styles.toolIcon}>{display.icon}</span> {display.label}</>
            ) : (
              entry.toolName
            )}
            {eventLabel && (
              <span className={styles.eventBadge}>{eventLabel}</span>
            )}
            <span className={`${styles.agentBadge} ${dotClass}`}>
              {AGENT_LABEL[entry.agentType] ?? entry.agentType}
            </span>
          </span>
          <span className={styles.entryTimestamp}>
            {formatTimestamp(entry.timestamp)}
          </span>
        </div>
        <div className={styles.entryDetail}>
          {entry.filePath && (
            <span className={styles.entryFilePath}>{entry.filePath}</span>
          )}
          {entry.filePath && formattedInput && (
            <span className={styles.entryInput}>&middot;</span>
          )}
          {!expanded && formattedInput && (
            <span className={styles.entryInput}>{formattedInput}</span>
          )}
        </div>
        {expanded && (
          <div className={styles.expandedContent}>
            {entry.toolInput && (
              <div className={styles.expandedSection}>
                <span className={styles.expandedLabel}>Input</span>
                <pre className={styles.expandedPre}>{entry.toolInput}</pre>
              </div>
            )}
            {entry.toolResponse && (
              <div className={styles.expandedSection}>
                <span className={styles.expandedLabel}>Response</span>
                <pre className={styles.expandedPre}>{entry.toolResponse}</pre>
              </div>
            )}
          </div>
        )}
      </div>
      {entry.projectHead && onRestore && (
        <div className={styles.entryActions}>
          <button
            className={styles.restoreBtn}
            onClick={(e) => {
              e.stopPropagation()
              onRestore(entry.projectHead!)
            }}
          >
            Restore
          </button>
        </div>
      )}
    </div>
  )
}

export function ContextHistoryPanel() {
  const toggleContextHistory = useAppStore((s) => s.toggleContextHistory)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const workspace = useAppStore((s) =>
    s.workspaces.find((w) => w.id === s.activeWorkspaceId),
  )
  const showConfirmDialog = useAppStore((s) => s.showConfirmDialog)
  const dismissConfirmDialog = useAppStore((s) => s.dismissConfirmDialog)
  const addToast = useAppStore((s) => s.addToast)
  const contextEnabled = useAppStore((s) => s.settings.contextCaptureEnabled)

  const [mode, setMode] = useState<'recent' | 'search'>('recent')
  const [searchQuery, setSearchQuery] = useState('')
  const [entries, setEntries] = useState<ContextEntry[]>([])
  const [loading, setLoading] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadRecent = useCallback(async () => {
    if (!workspace?.worktreePath || !activeWorkspaceId) {
      setEntries([])
      return
    }
    setLoading(true)
    try {
      // Ensure context repo exists for this workspace
      if (contextEnabled) {
        await window.api.context.repoInit(workspace.worktreePath, activeWorkspaceId).catch(() => {})
      }
      const result = await window.api.context.getRecent(
        workspace.worktreePath,
        activeWorkspaceId,
        100,
      )
      setEntries(result ?? [])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [workspace?.worktreePath, activeWorkspaceId, contextEnabled])

  const doSearch = useCallback(
    async (query: string) => {
      if (!workspace?.worktreePath || !query.trim()) {
        setEntries([])
        return
      }
      setLoading(true)
      try {
        const result = await window.api.context.search(
          workspace.worktreePath,
          query.trim(),
          100,
        )
        setEntries(result ?? [])
      } catch {
        setEntries([])
      } finally {
        setLoading(false)
      }
    },
    [workspace?.worktreePath],
  )

  // Load recent on mount / workspace change
  useEffect(() => {
    if (mode === 'recent') loadRecent()
  }, [mode, loadRecent])

  // Debounced search
  useEffect(() => {
    if (mode !== 'search') return
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!searchQuery.trim()) {
      setEntries([])
      return
    }
    searchTimerRef.current = setTimeout(() => doSearch(searchQuery), 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [mode, searchQuery, doSearch])

  // Escape to close
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleContextHistory()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleContextHistory])

  const handleRestore = (projectHead: string) => {
    if (!workspace?.worktreePath) return
    const worktreePath = workspace.worktreePath
    showConfirmDialog({
      title: 'Restore Checkpoint',
      message:
        'This will restore all project files to this point. Uncommitted changes will be overwritten.',
      confirmLabel: 'Restore',
      destructive: true,
      onConfirm: async () => {
        try {
          await window.api.context.restoreCheckpoint(worktreePath, projectHead)
          dismissConfirmDialog()
          addToast({
            id: crypto.randomUUID(),
            message: 'Checkpoint restored',
            type: 'info',
          })
        } catch {
          dismissConfirmDialog()
          addToast({
            id: crypto.randomUUID(),
            message: 'Failed to restore checkpoint',
            type: 'error',
          })
        }
      },
    })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerLeft}>
            <Tooltip label="Back" shortcut="⇧⌘K">
              <button
                className={styles.backBtn}
                onClick={toggleContextHistory}
              >
                ‹
              </button>
            </Tooltip>
            <h2 className={styles.title}>Context History</h2>
          </div>
          <div className={styles.modeToggle}>
            <button
              onClick={() => setMode('recent')}
              className={mode === 'recent' ? styles.active : ''}
            >
              Recent
            </button>
            <button
              onClick={() => setMode('search')}
              className={mode === 'search' ? styles.active : ''}
            >
              Search
            </button>
          </div>
        </div>
        {mode === 'search' && (
          <input
            className={styles.searchInput}
            placeholder="Search context entries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        )}
      </div>

      <div className={styles.content}>
        <div className={styles.inner}>
          {!contextEnabled ? (
            <div className={styles.emptyState}>
              <span>Context capture is disabled.</span>
              <span>Enable it in Settings under Agent Integrations.</span>
            </div>
          ) : loading ? (
            <div className={styles.loading}>Loading...</div>
          ) : entries.length === 0 ? (
            <div className={styles.emptyState}>
              <span>
                {mode === 'search' && searchQuery
                  ? 'No entries match your search.'
                  : 'No context entries yet.'}
              </span>
              {mode === 'recent' && (
                <span>Run an agent with context capture enabled to see entries here.</span>
              )}
            </div>
          ) : (
            entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                onRestore={handleRestore}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
