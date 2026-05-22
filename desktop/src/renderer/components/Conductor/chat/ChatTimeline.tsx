import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { TranscriptMessage } from '../../../../shared/pi/pi-desktop-state'
import type { TimelineToolCall } from '../../../../shared/pi/timeline-types'
import type { AgentProvider } from '../../../../shared/agent-chat-types'
import type { ThinkingLevel } from '../../../../shared/conductor-thinking'
import { isSubagentToolCall } from '../../../../shared/conductor-subagent-utils'
import { buildTurnDurationMap, parseWorkedForLabel } from '../../../../shared/conductor-transcript-utils'
import { getAssistantStreamMessageId } from '../../../pi-gui/transcript-stream'
import { ErrorBoundary } from '../../ErrorBoundary/ErrorBoundary'
import { ChatMessage } from './ChatMessage'
import { BrailleLoader } from './BrailleLoader'
import { ActivityTicker } from './ActivityTicker'
import { MarkdownBody } from './MarkdownBody'
import { TurnSummary } from './TurnSummary'
import { SubagentCallCard } from './SubagentCallCard'
import { ToolPart } from './tools/tool-registry'
import { turnHasFileTools, turnHasTodoTools } from './tools/turn-tool-flags'
import { TurnHistoryRail, type TurnHistoryRailHandle } from './TurnHistoryRail'

const WORKING_LABEL = 'Working…'
const STOPPED_LABEL = 'Stopped'
const NEAR_BOTTOM_PX = 80
const HIGHLIGHT_MS = 2000
const TURN_COLLAPSE_MIN_TOOLS = 2

import styles from '../Conductor.module.css'

export interface ChatTimelineHandle {
  scrollToMessage: (messageId: string) => void
  openHistory: () => void
}

type RenderUnit =
  | { type: 'item'; item: TranscriptMessage }
  | {
      type: 'turnGroup'
      key: string
      items: TranscriptMessage[]
      toolCount: number
      messageCount: number
      isPlan: boolean
    }
  | {
      type: 'assistantGroup'
      key: string
      messages: Extract<TranscriptMessage, { kind: 'message' }>[]
      /** Codex/Cursor tool rows for this turn (shown above assistant prose). */
      tools: TimelineToolCall[]
    }

type ChatMessageItem = Extract<TranscriptMessage, { kind: 'message' }>

function isAssistantMessage(item: TranscriptMessage): item is ChatMessageItem {
  return item.kind === 'message' && item.role === 'assistant'
}

function isWorkingActivity(item: TranscriptMessage): boolean {
  return item.kind === 'activity' && item.label === WORKING_LABEL
}

function isHiddenTranscriptItem(item: TranscriptMessage): boolean {
  return item.kind === 'summary'
}

function isCollapsibleTool(item: TranscriptMessage): boolean {
  return item.kind === 'tool' && !isSubagentToolCall(item)
}

/** Split deferred Working… rows from the rest of a turn body (rendered last). */
function partitionTurnBody(body: readonly TranscriptMessage[]): {
  items: TranscriptMessage[]
  workingActivity: TranscriptMessage[]
} {
  const items: TranscriptMessage[] = []
  const workingActivity: TranscriptMessage[] = []
  for (const item of body) {
    if (isWorkingActivity(item)) {
      workingActivity.push(item)
    } else {
      items.push(item)
    }
  }
  return { items, workingActivity }
}

function pushTurnAssistantGroup(
  result: RenderUnit[],
  assistants: readonly ChatMessageItem[],
  keyPrefix: string,
  tools: readonly TranscriptMessage[],
  pushPlain: (item: TranscriptMessage) => void,
): void {
  if (assistants.length === 0 && tools.length === 0) return
  const toolCalls = tools.filter((item): item is TimelineToolCall => item.kind === 'tool')
  if (assistants.length === 1 && toolCalls.length === 0) {
    pushPlain(assistants[0])
    return
  }
  if (assistants.length === 0 && toolCalls.length > 0) {
    for (const tool of toolCalls) {
      pushPlain(tool)
    }
    return
  }
  result.push({
    type: 'assistantGroup',
    key: `${keyPrefix}:a:${assistants[0]?.id ?? 'tools'}`,
    messages: [...assistants],
    tools: toolCalls,
  })
}

function splitTurnAssistants(bodyItems: readonly TranscriptMessage[]): {
  assistants: ChatMessageItem[]
  rest: TranscriptMessage[]
} {
  const assistants: ChatMessageItem[] = []
  const rest: TranscriptMessage[] = []
  for (const item of bodyItems) {
    if (isAssistantMessage(item)) {
      assistants.push(item)
    } else {
      rest.push(item)
    }
  }
  return { assistants, rest }
}

export const ChatTimeline = forwardRef<
  ChatTimelineHandle,
  {
    transcript: readonly TranscriptMessage[]
    running?: boolean
    runStartedAt?: number | null
    planActive?: boolean
    onSelectHistoryTurn?: (messageId: string, refillComposer: boolean) => void
    onFork?: (messageId: string) => void
    forkDisabled?: boolean
    provider?: AgentProvider
    model?: string
    thinkingLevel?: ThinkingLevel
  }
>(function ChatTimeline(
  {
    transcript,
    running = false,
    runStartedAt = null,
    planActive = false,
    onSelectHistoryTurn,
    onFork,
    forkDisabled,
    provider,
    model,
    thinkingLevel,
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const turnHistoryRailRef = useRef<TurnHistoryRailHandle | null>(null)
  const pinnedRef = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const assistantStreamMessageId = useMemo(
    () => getAssistantStreamMessageId(transcript, running),
    [transcript, running],
  )

  const durationByMessageId = useMemo(() => buildTurnDurationMap(transcript), [transcript])

  const runningSubagentIndexById = useMemo(() => {
    const map = new Map<string, number>()
    let idx = 0
    for (const item of transcript) {
      if (item.kind === 'tool' && isSubagentToolCall(item) && item.status === 'running') {
        map.set(item.id, idx++)
      }
    }
    return map
  }, [transcript])

  const lastUserIndex = useMemo(() => {
    let idx = -1
    transcript.forEach((item, i) => {
      if (item.kind === 'message' && item.role === 'user') idx = i
    })
    return idx
  }, [transcript])

  // Non-subagent tools of the active turn drive the live ticker.
  const currentTurnTools = useMemo(() => {
    const tools: TimelineToolCall[] = []
    for (let i = lastUserIndex + 1; i < transcript.length; i += 1) {
      const item = transcript[i]
      if (item.kind === 'tool' && !isSubagentToolCall(item)) tools.push(item)
    }
    return tools
  }, [transcript, lastUserIndex])

  const currentTurnToolIds = useMemo(
    () => new Set(currentTurnTools.map((tool) => tool.id)),
    [currentTurnTools],
  )
  const tickerCompleted = useMemo(
    () => currentTurnTools.filter((tool) => tool.status !== 'running'),
    [currentTurnTools],
  )
  const runningLabel = currentTurnTools.find((tool) => tool.status === 'running')?.label
  const runningTool = currentTurnTools.find((tool) => tool.status === 'running')
  // Collapse a completed turn's TOOL rows behind a disclosure — never its
  // messages. Assistant/user prose always stays visible (collapsing it would
  // hide earlier answers).
  const units = useMemo<RenderUnit[]>(() => {
    const result: RenderUnit[] = []
    const n = transcript.length
    let i = 0
    const isUser = (item: TranscriptMessage) => item.kind === 'message' && item.role === 'user'
    const isCollapsibleTool = (item: TranscriptMessage) =>
      item.kind === 'tool' && !isSubagentToolCall(item)

    while (i < n && !isUser(transcript[i])) {
      result.push({ type: 'item', item: transcript[i] })
      i += 1
    }
    while (i < n) {
      const userItem = transcript[i]
      result.push({ type: 'item', item: userItem })
      i += 1
      const body: TranscriptMessage[] = []
      while (i < n && !isUser(transcript[i])) {
        const item = transcript[i]
        if (!isHiddenTranscriptItem(item)) body.push(item)
        i += 1
      }
      const { items: bodyItems, workingActivity } = partitionTurnBody(body)
      const isLatestTurn = i >= n
      const { assistants, rest: nonAssistantBody } = splitTurnAssistants(bodyItems)
      const visibleNonAssistantBody =
        isLatestTurn && running
          ? nonAssistantBody.filter(
              (item) =>
                !isCollapsibleTool(item) ||
                (item.kind === 'tool' && item.status !== 'running'),
            )
          : nonAssistantBody
      const toolRows = visibleNonAssistantBody.filter(isCollapsibleTool)
      const otherBody = visibleNonAssistantBody.filter((item) => !isCollapsibleTool(item))
      const messageCount = assistants.length
      const pushPlain = (item: TranscriptMessage) => result.push({ type: 'item', item })
      // Collapse only older turns; latest turn keeps Cursor-style tool rows visible.
      // While the latest turn is running, tools stay in the live ticker instead.
      const shouldCollapseTurn =
        toolRows.length >= TURN_COLLAPSE_MIN_TOOLS && !isLatestTurn
      if (shouldCollapseTurn) {
        pushTurnAssistantGroup(result, assistants, userItem.id, [], pushPlain)
        result.push({
          type: 'turnGroup',
          key: `${userItem.id}:group`,
          items: toolRows,
          toolCount: toolRows.length,
          messageCount,
          isPlan: planActive,
        })
      } else {
        pushTurnAssistantGroup(result, assistants, userItem.id, toolRows, pushPlain)
      }
      for (const item of otherBody) {
        pushPlain(item)
      }
      for (const activity of workingActivity) {
        pushPlain(activity)
      }
    }
    return result
  }, [transcript, planActive, running])

  const latestTurnKey = useMemo(() => {
    for (let i = units.length - 1; i >= 0; i -= 1) {
      const unit = units[i]
      if (unit.type === 'turnGroup') return unit.key
    }
    return null
  }, [units])

  const scrollToMessage = useCallback((messageId: string) => {
    const root = scrollRef.current
    if (!root) return
    const el = root.querySelector(`[data-message-id="${messageId}"]`)
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setHighlightMessageId(messageId)
      if (highlightTimerRef.current !== undefined) clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = setTimeout(() => {
        setHighlightMessageId(null)
        highlightTimerRef.current = undefined
      }, HIGHLIGHT_MS)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    scrollToMessage,
    openHistory: () => turnHistoryRailRef.current?.open(),
  }), [scrollToMessage])

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== undefined) clearTimeout(highlightTimerRef.current)
    }
  }, [])

  const isNearBottom = useCallback((): boolean => {
    const el = scrollRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  }, [])

  const onScroll = useCallback(() => {
    pinnedRef.current = isNearBottom()
    setShowJump(!pinnedRef.current)
  }, [isNearBottom])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    pinnedRef.current = true
    setShowJump(false)
  }, [])

  useLayoutEffect(() => {
    if (pinnedRef.current) scrollToBottom()
  }, [transcript, scrollToBottom])

  useEffect(() => {
    const seen = seenIdsRef.current
    for (const item of transcript) seen.add(item.id)
  }, [transcript])

  const renderAssistantMessage = useCallback(
    (
      message: ChatMessageItem,
      options?: {
        hideRole?: boolean
        isSegment?: boolean
        showFooter?: boolean
        afterBody?: ReactNode
        hideMarkdownTaskLists?: boolean
        hideMarkdownFileEcho?: boolean
      },
    ): ReactNode => {
      const firstPaint = !seenIdsRef.current.has(message.id)
      return (
        <ChatMessage
          message={message}
          firstPaint={firstPaint}
          isStreaming={message.role === 'assistant' && message.id === assistantStreamMessageId}
          highlighted={message.id === highlightMessageId}
          onFork={
            options?.showFooter === false || message.role !== 'assistant' ? undefined : onFork
          }
          forkDisabled={forkDisabled}
          durationLabel={
            options?.showFooter === false || message.role !== 'assistant'
              ? undefined
              : durationByMessageId.get(message.id)
          }
          hideRole={options?.hideRole}
          isSegment={options?.isSegment}
          suppressIdleLoader={running}
          afterBody={options?.afterBody}
          hideMarkdownTaskLists={options?.hideMarkdownTaskLists}
          hideMarkdownFileEcho={options?.hideMarkdownFileEcho}
        />
      )
    },
    [
      assistantStreamMessageId,
      highlightMessageId,
      onFork,
      forkDisabled,
      durationByMessageId,
      running,
    ],
  )

  const renderItemInner = useCallback(
    (item: TranscriptMessage): ReactNode => {
      switch (item.kind) {
        case 'message':
          return renderAssistantMessage(item)
        case 'tool':
          if (isSubagentToolCall(item) && provider && model && thinkingLevel) {
            return (
              <SubagentCallCard
                tool={item}
                provider={provider}
                model={model}
                thinkingLevel={thinkingLevel}
                subagentIndex={runningSubagentIndexById.get(item.id) ?? 0}
              />
            )
          }
          return <ToolPart tool={item} />
        case 'activity':
          if (item.label === WORKING_LABEL) {
            return currentTurnTools.length > 0 ? (
              <ActivityTicker
                items={tickerCompleted}
                activeTool={runningTool}
                running={running}
                startedAt={runStartedAt}
                runningLabel={runningLabel}
              />
            ) : (
              <div className={styles.workingRow}>
                <BrailleLoader startedAt={runStartedAt} />
              </div>
            )
          }
          if (item.label === STOPPED_LABEL) {
            return <div className={styles.interruptPill}>INTERRUPTED BY USER</div>
          }
          return (
            <div className={`${styles.activityRow} ${item.tone === 'error' ? styles.activityError : ''}`}>
              <MarkdownBody content={item.label} className={styles.activityRowMarkdown} compact inline />
              {item.metadata && !parseWorkedForLabel(item.metadata) ? (
                <MarkdownBody content={item.metadata} className={styles.activityRowMeta} compact inline />
              ) : null}
            </div>
          )
        case 'summary':
          return null
        default:
          return null
      }
    },
    [
      renderAssistantMessage,
      provider,
      model,
      thinkingLevel,
      runningSubagentIndexById,
      currentTurnTools.length,
      tickerCompleted,
      running,
      runStartedAt,
      runningLabel,
      runningTool,
    ],
  )

  const renderRow = useCallback(
    (item: TranscriptMessage): { node: ReactNode; variant?: 'tool' } | null => {
      // Only the in-flight tool uses the live ticker; completed tools stay in the turn body.
      if (
        item.kind === 'tool' &&
        running &&
        item.status === 'running' &&
        currentTurnToolIds.has(item.id)
      ) {
        return null
      }
      const node = renderItemInner(item)
      if (node === null || node === undefined) return null
      return {
        node: (
          <ErrorBoundary
            fallback={<div className={styles.activityRow}>Couldn&apos;t render this Conductor event.</div>}
          >
            {node}
          </ErrorBoundary>
        ),
        variant: item.kind === 'tool' ? 'tool' : undefined,
      }
    },
    [running, currentTurnToolIds, renderItemInner],
  )

  const renderTimelineRow = useCallback(
    (key: string, content: ReactNode, variant?: 'tool'): ReactNode => {
      if (content === null || content === undefined) return null
      return (
        <div
          key={key}
          className={variant === 'tool' ? `${styles.timelineRow} ${styles.timelineRowTool}` : styles.timelineRow}
        >
          {content}
        </div>
      )
    },
    [],
  )

  if (transcript.length === 0) {
    return (
      <div className={styles.timelineWrap}>
        <div className={styles.timeline} ref={scrollRef} onScroll={onScroll}>
          <div className={styles.empty}>
            <div>Start a conversation</div>
            <div>Pick a model below and send a message.</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.timelineWrap}>
      <div className={styles.timeline} ref={scrollRef} onScroll={onScroll}>
        <div className={styles.timelineStack}>
          {units.map((unit) => {
            if (unit.type === 'item') {
              const row = renderRow(unit.item)
              return row ? renderTimelineRow(unit.item.id, row.node, row.variant) : null
            }
            if (unit.type === 'assistantGroup') {
              const lastId = unit.messages[unit.messages.length - 1]?.id
              const toolCalls = unit.tools
              const hasFileTools = turnHasFileTools(toolCalls)
              const hasTodoTools = turnHasTodoTools(toolCalls)
              const turnTools =
                toolCalls.length > 0 ? (
                  <div className={styles.assistantTurnTools} data-testid="assistant-turn-tools">
                    {toolCalls.map((tool) => {
                      const row = renderRow(tool)
                      return row ? <div key={tool.id}>{row.node}</div> : null
                    })}
                  </div>
                ) : null
              const isLastMessage = (messageId: string) => messageId === lastId
              return renderTimelineRow(
                unit.key,
                <div className={styles.assistantGroup}>
                  {turnTools}
                  {unit.messages.map((message, index) => (
                    <ErrorBoundary
                      key={message.id}
                      fallback={
                        <div className={styles.activityRow}>Couldn&apos;t render this Conductor event.</div>
                      }
                    >
                      {renderAssistantMessage(message, {
                        hideRole: true,
                        isSegment: index > 0,
                        showFooter: isLastMessage(message.id),
                        hideMarkdownTaskLists: isLastMessage(message.id) && hasTodoTools,
                        hideMarkdownFileEcho: isLastMessage(message.id) && hasFileTools,
                      })}
                    </ErrorBoundary>
                  ))}
                </div>,
              )
            }
            return (
              <div key={unit.key} className={styles.turnSummaryEdge}>
                <TurnSummary
                  toolCount={unit.toolCount}
                  messageCount={unit.messageCount}
                  isPlan={unit.isPlan}
                  defaultExpanded={unit.key === latestTurnKey}
                >
                  {unit.items.map((item) => {
                    const row = renderRow(item)
                    return row ? (
                      <div key={item.id} className={styles.turnSummaryToolRow}>
                        {row.node}
                      </div>
                    ) : null
                  })}
                </TurnSummary>
              </div>
            )
          })}
        </div>
        {showJump && (
          <button type="button" className={styles.jumpToLatest} onClick={scrollToBottom}>
            Jump to latest ↓
          </button>
        )}
      </div>
      {onSelectHistoryTurn ? (
        <TurnHistoryRail
          ref={turnHistoryRailRef}
          transcript={transcript}
          scrollContainerRef={scrollRef}
          onSelectTurn={onSelectHistoryTurn}
        />
      ) : null}
    </div>
  )
})
