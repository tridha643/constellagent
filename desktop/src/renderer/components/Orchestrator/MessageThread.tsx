import { useEffect, useRef } from 'react'
import type { OrchestratorMessage } from '../../../shared/orchestrator-types'
import styles from './OrchestratorPanel.module.css'

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageThread({ messages }: { messages: OrchestratorMessage[] }) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages.length])

  if (messages.length === 0) {
    return (
      <div className={styles.messageList}>
        <div className={styles.emptyState}>
          No messages yet. Send a command or text the orchestrator via SendBlue.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.messageList} ref={listRef}>
      {messages.map((msg) => {
        const bubbleClass =
          msg.direction === 'inbound'
            ? styles.messageInbound
            : msg.direction === 'outbound'
              ? styles.messageOutbound
              : styles.messageSystem

        return (
          <div key={msg.id} className={`${styles.messageBubble} ${bubbleClass}`}>
            <div>{msg.content}</div>
            <div className={styles.messageTime}>{formatTime(msg.timestamp)}</div>
          </div>
        )
      })}
    </div>
  )
}
