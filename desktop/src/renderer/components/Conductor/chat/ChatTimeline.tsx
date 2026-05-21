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
    }

type ChatMessageItem = Extract<TranscriptMessage, { kind: 'message' }>

function isAssistantMessage(item: TranscriptMessage): item is ChatMessageItem {
  return item.kind === 'message' && item.role === 'assistant'
}

function isWorkingActivity(item: TranscriptMessage): boolean {
  return item.kind === 'activity' && item.label === WORKING_LABEL
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
  pushPlain: (item: TranscriptMessage) => void,
): void {
  if (assistants.length === 0) return
  if (assistants.length === 1) {
    pushPlain(assistants[0])
    return
  }
  result.push({
    type: 'assistantGroup',
    key: `${keyPrefix}:a:${assistants[0].id}`,
    messages: [...assistants],
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
        body.push(transcript[i])
        i += 1
      }
      const { items: bodyItems, workingActivity } = partitionTurnBody(body)
      const isLatestTurn = i >= n
      const { assistants, rest: nonAssistantBody } = splitTurnAssistants(bodyItems)
      const toolRows = nonAssistantBody.filter(isCollapsibleTool)
      const messageCount = assistants.length
      const pushPlain = (item: TranscriptMessage) => result.push({ type: 'item', item })
      // Collapse completed turns (including the latest once idle). While the
      // latest turn is still running, tools stay in the live ticker instead.
      const shouldCollapseTurn =
        toolRows.length >= TURN_COLLAPSE_MIN_TOOLS && (!isLatestTurn || !running)
      if (shouldCollapseTurn) {
        result.push({
          type: 'turnGroup',
          key: `${userItem.id}:group`,
          items: toolRows,
          toolCount: toolRows.length,
          messageCount,
          isPlan: planActive,
        })
      } else {
        for (const item of nonAssistantBody) {
          pushPlain(item)
        }
      }
      pushTurnAssistantGroup(result, assistants, userItem.id, pushPlain)
      for (const activity of workingActivity) {
        pushPlain(activity)
      }
    }
    return result
  }, [transcript, planActive, running])

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
    ],
  )

  const renderRow = useCallback(
    (item: TranscriptMessage): ReactNode => {
      // Active-turn tools live in the ticker while running; don't double-render them.
      if (item.kind === 'tool' && running && currentTurnToolIds.has(item.id)) return null
      const node = renderItemInner(item)
      if (node === null || node === undefined) return null
      return (
        <ErrorBoundary
          key={item.id}
          fallback={<div className={styles.activityRow}>Couldn&apos;t render this Conductor event.</div>}
        >
          {node}
        </ErrorBoundary>
      )
    },
    [running, currentTurnToolIds, renderItemInner],
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
              return (
                <div key={unit.item.id} className={styles.timelineRow}>
                  {renderRow(unit.item)}
                </div>
              )
            }
            if (unit.type === 'assistantGroup') {
              const lastId = unit.messages[unit.messages.length - 1]?.id
              return (
                <div key={unit.key} className={styles.timelineRow}>
                  <div className={styles.assistantGroup}>
                    <div className={styles.messageRole}>Assistant</div>
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
                          showFooter: message.id === lastId,
                        })}
                      </ErrorBoundary>
                    ))}
                  </div>
                </div>
              )
            }
            return (
              <div key={unit.key} className={styles.turnSummaryEdge}>
                <TurnSummary
                  toolCount={unit.toolCount}
                  messageCount={unit.messageCount}
                  isPlan={unit.isPlan}
                  defaultExpanded={false}
                >
                  {unit.items.map((item) => renderRow(item))}
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
