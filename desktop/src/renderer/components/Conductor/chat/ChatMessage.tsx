import { useLayoutEffect, useRef } from 'react'
import type { TranscriptMessage } from '../../../../shared/pi/pi-desktop-state'
import MarkdownStream, { type MarkdownStreamHandle } from '../../../lib/prosemark/MarkdownStream'
import { BrailleLoader } from './BrailleLoader'
import { MarkdownBody } from './MarkdownBody'
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
  durationLabel,
  hideRole,
  isSegment,
  suppressIdleLoader,
}: {
  message: ChatMessageItem
  firstPaint?: boolean
  isStreaming?: boolean
  highlighted?: boolean
  onFork?: (messageId: string) => void
  forkDisabled?: boolean
  durationLabel?: string
  /** Hide the role label — used for continuation segments in a grouped assistant turn. */
  hideRole?: boolean
  /** Extra spacing before this segment within a grouped assistant turn. */
  isSegment?: boolean
  /** Skip the inline Braille loader; the turn-level activity ticker owns loading UX. */
  suppressIdleLoader?: boolean
}) {
  const isUser = message.role === 'user'
  const streamRef = useRef<MarkdownStreamHandle | null>(null)
  const lastTextRef = useRef('')
  const lastMessageIdRef = useRef(message.id)
  const showBraille =
    !isUser && isStreaming && message.text.trim().length === 0 && !suppressIdleLoader
  const showFooter =
    !isUser && !isStreaming && !showBraille && message.text.trim().length > 0 && onFork

  if (lastMessageIdRef.current !== message.id) {
    lastMessageIdRef.current = message.id
    lastTextRef.current = ''
  }

  useLayoutEffect(() => {
    if (isUser) return
    const handle = streamRef.current
    if (!handle) return
    const next = message.text
    const prev = lastTextRef.current
    if (next === prev) return
    if (next.startsWith(prev)) {
      handle.appendDelta(next.slice(prev.length))
    } else {
      handle.setContent(next)
    }
    lastTextRef.current = next
  }, [message.text, isUser, message.id])

  useLayoutEffect(() => {
    if (isUser || isStreaming) return
    streamRef.current?.refreshDecorations()
  }, [isStreaming, isUser, message.id, message.text])

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
        <MarkdownBody content={message.text} className={styles.messageBody} />
      ) : showBraille ? (
        <div className={styles.messageBody}>
          <BrailleLoader />
        </div>
      ) : (
        <>
          <MarkdownStream ref={streamRef} className={styles.messageBody} content={message.text} />
          {showFooter ? (
            <MessageFooter
              copyText={message.text}
              onFork={() => onFork(message.id)}
              forkDisabled={forkDisabled}
              durationLabel={durationLabel}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
