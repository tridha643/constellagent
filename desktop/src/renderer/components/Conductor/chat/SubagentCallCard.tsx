import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { AgentProvider } from '../../../../shared/agent-chat-types'
import type { ThinkingLevel } from '../../../../shared/conductor-thinking'
import { THINKING_LABELS, isReasoningEffortActive, normalizeThinkingLevel } from '../../../../shared/conductor-thinking'
import { conductorModelPresets, displayModelName, isFastModel } from '../../../../shared/conductor-model-utils'
import type { TimelineToolCall } from '../../../../shared/pi/timeline-types'
import { isSubagentToolCall, parseSubagentMetadata } from '../../../../shared/conductor-subagent-utils'
import { safeJsonStringify } from '../../../../shared/json-safe'
import { MarkdownBody, toolOutputAsMarkdown } from './MarkdownBody'
import { ProviderIcon, ReasoningIcon, SubagentCornerIcon } from './ConductorIcons'
import styles from '../Conductor.module.css'

function modelLabel(provider: AgentProvider, model: string): string {
  const preset = conductorModelPresets(provider).find((m) => m.cliModel === model)
  return displayModelName(preset?.label ?? model)
}

export function SubagentCallCard({
  tool,
  provider,
  model,
  thinkingLevel,
  subagentIndex = 0,
}: {
  tool: TimelineToolCall
  provider: AgentProvider
  model: string
  thinkingLevel: ThinkingLevel
  subagentIndex?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const [statusKey, setStatusKey] = useState(0)
  const prevDetailRef = useRef(tool.detail)
  const meta = parseSubagentMetadata(tool.metadata)
  const displayModel = meta?.model ?? model
  const displayThinking = meta?.thinkingLevel
    ? normalizeThinkingLevel(meta.thinkingLevel)
    : thinkingLevel

  useEffect(() => {
    if (tool.detail !== prevDetailRef.current) {
      prevDetailRef.current = tool.detail
      setStatusKey((k) => k + 1)
    }
  }, [tool.detail])

  const running = tool.status === 'running'
  const done = tool.status === 'success'
  const showSubtitle = running && tool.detail
  const rawDetail =
    tool.output === undefined || tool.output === null
      ? ''
      : typeof tool.output === 'string'
        ? tool.output
        : safeJsonStringify(tool.output, 2)
  const detail = toolOutputAsMarkdown(tool, rawDetail)

  const rowClass = [
    styles.subagentRow,
    running ? styles.subagentRowRunning : '',
    done ? styles.subagentRowDone : '',
    styles.subagentRowEnter,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={rowClass}
      style={{ '--subagent-index': subagentIndex } as CSSProperties}
      data-subagent-status={tool.status}
    >
      <button
        type="button"
        className={styles.subagentRowButton}
        onClick={() => detail && setExpanded((v) => !v)}
        disabled={!detail}
        aria-expanded={expanded}
      >
        <span className={styles.subagentCorner}>
          <SubagentCornerIcon size={14} pulsing={running} />
        </span>
        <span className={styles.subagentContent}>
          <span className={styles.subagentTitleRow}>
            <span className={`${styles.subagentTitle} ${done ? styles.subagentTitleDone : ''}`}>
              {tool.label}
            </span>
            <span className={styles.subagentMeta}>
              {meta?.subagentType ? (
                <span className={styles.subagentSpeedPill}>{meta.subagentType}</span>
              ) : null}
              <ProviderIcon provider={provider} size={14} />
              <span>{modelLabel(provider, displayModel)}</span>
              {isReasoningEffortActive(displayThinking) && (
                <>
                  <ReasoningIcon size={12} />
                  <span>{THINKING_LABELS[displayThinking]}</span>
                </>
              )}
              {isFastModel(displayModel) && <span className={styles.subagentSpeedPill}>Fast</span>}
              {meta?.durationMs != null && done ? (
                <span>{Math.round(meta.durationMs / 1000)}s</span>
              ) : null}
            </span>
          </span>
          {showSubtitle ? (
            <span key={statusKey} className={styles.subagentStatus}>
              {tool.detail}
            </span>
          ) : null}
        </span>
      </button>
      {expanded && detail ? (
        <MarkdownBody content={detail} className={styles.subagentExpanded} compact />
      ) : null}
    </div>
  )
}

export { isSubagentToolCall }
