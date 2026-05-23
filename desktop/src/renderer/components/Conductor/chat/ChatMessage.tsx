import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type { TranscriptMessage } from '../../../../shared/pi/pi-desktop-state'
import { normalizeMarkdownTables } from '../../../../shared/normalize-markdown-tables'
import MarkdownStream, { type MarkdownStreamHandle } from '../../../lib/prosemark/MarkdownStream'
import { useMarkdownSurfaceContext } from '../../../hooks/useMarkdownSurfaceContext'
import { BrailleLoader } from './BrailleLoader'
import { MarkdownBody } from '../../Markdown/MarkdownBody'
import { MessageFooter } from './MessageFooter'
import styles from '../Conductor.module.css'

type ChatMessageItem = Extract<TranscriptMessage, { kind: 'message' }>

/**
 * Renders one user/assistant message through ProseMark. Assistant bodies stream
 * into a CodeMirror live-preview; user messages use the static MarkdownBody wrapper.
 */
export function ChatMessage({
  message,
  firstPaint,
  isStreaming,
  highlighted,
  onFork,
  forkDisabled,
  onApprovePlan,
  approveDisabled,
  showApprove,
  durationLabel,
  hideRole,
  isSegment,
  suppressIdleLoader,
  afterBody,
  hideMarkdownTaskLists,
  hideMarkdownFileEcho,
}: {
  message: ChatMessageItem
  firstPaint?: boolean
  isStreaming?: boolean
  highlighted?: boolean
  onFork?: (messageId: string) => void
  forkDisabled?: boolean
  onApprovePlan?: (messageId: string) => void
  approveDisabled?: boolean
  showApprove?: boolean
  durationLabel?: string
  /** Hide the role label — used for continuation segments in a grouped assistant turn. */
  hideRole?: boolean
  /** Extra spacing before this segment within a grouped assistant turn. */
  isSegment?: boolean
  /** Skip the inline Braille loader; the turn-level activity ticker owns loading UX. */
  suppressIdleLoader?: boolean
  /** Tool rows for this turn — prefer rendering at the assistant-group level above prose. */
  afterBody?: ReactNode
  /** Hide ProseMark task-list checkboxes when transcript already renders Codex todos. */
  hideMarkdownTaskLists?: boolean
  /** Hide Codex echo tables/code fences when transcript renders file tool rows. */
  hideMarkdownFileEcho?: boolean
}) {
  const isUser = message.role === 'user'
  const { appearanceThemeId, worktreePath, openMarkdownFile } = useMarkdownSurfaceContext()
  const normalizedText = useMemo(
    () => normalizeMarkdownTables(message.text),
    [message.text],
  )
  const streamRef = useRef<MarkdownStreamHandle | null>(null)
  const lastTextRef = useRef('')
  const lastMessageIdRef = useRef(message.id)
  const showBraille =
    !isUser && isStreaming && message.text.trim().length === 0 && !suppressIdleLoader
  const showFooter =
    !isUser &&
    !isStreaming &&
    !showBraille &&
    message.text.trim().length > 0 &&
    (onFork || onApprovePlan)
  const imageAttachments =
    message.attachments?.filter((attachment) => attachment.kind === 'image') ?? []

  if (lastMessageIdRef.current !== message.id) {
    lastMessageIdRef.current = message.id
    lastTextRef.current = ''
  }

  useLayoutEffect(() => {
    if (isUser) return
    const handle = streamRef.current
    if (!handle) return
    const next = normalizedText
    const prev = lastTextRef.current
    if (next === prev) return
    if (next.startsWith(prev)) {
      handle.appendDelta(next.slice(prev.length))
    } else {
      handle.setContent(next)
    }
    lastTextRef.current = next
  }, [normalizedText, isUser, message.id])

  useLayoutEffect(() => {
    if (isUser || isStreaming) return
    streamRef.current?.refreshDecorations()
  }, [isStreaming, isUser, message.id, normalizedText])

  return (
    <div
      className={`${styles.message} ${isUser ? styles.messageUser : styles.messageAssistant} ${
        hideRole ? styles.messageSegment : ''
      } ${isSegment ? styles.messageSegmentGap : ''} ${
        firstPaint && !hideRole ? styles.messageFirstPaint : ''
      } ${highlighted ? styles.messageHighlight : ''}`}
      data-message-id={message.id}
    >
      {!hideRole ? <div className={styles.messageRole}>{isUser ? 'You' : 'Assistant'}</div> : null}
      {isUser ? (
        <div className={styles.messageBody}>
          {imageAttachments.length > 0 ? (
            <div className={styles.messageAttachments}>
              {imageAttachments.map((attachment, index) => (
                <img
                  alt={attachment.name ?? `Attachment ${index + 1}`}
                  className={styles.messageAttachmentImage}
                  key={`${message.id}:${index}`}
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                />
              ))}
            </div>
          ) : null}
          <MarkdownBody content={normalizedText} />
        </div>
      ) : showBraille ? (
        <div className={styles.messageBody}>
          <BrailleLoader />
        </div>
      ) : (
        <>
          <MarkdownStream
            ref={streamRef}
            className={[
              styles.messageBody,
              hideMarkdownTaskLists ? styles.messageBodyHideTaskLists : '',
              hideMarkdownFileEcho ? styles.messageBodyHideFileEcho : '',
            ]
              .filter(Boolean)
              .join(' ')}
            content={normalizedText}
            worktreePath={worktreePath}
            appearanceThemeId={appearanceThemeId}
            onOpenMarkdownFile={openMarkdownFile}
          />
          {afterBody}
          {showFooter ? (
            <MessageFooter
              copyText={message.text}
              onFork={onFork ? () => onFork(message.id) : undefined}
              forkDisabled={forkDisabled}
              showApprove={showApprove}
              onApprovePlan={onApprovePlan ? () => onApprovePlan(message.id) : undefined}
              approveDisabled={approveDisabled}
              durationLabel={durationLabel}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
