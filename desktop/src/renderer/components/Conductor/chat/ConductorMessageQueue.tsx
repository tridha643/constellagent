import { useEffect, useId, useState } from 'react'
import type { QueuedAgentMessage } from '../../../../shared/agent-chat-types'
import styles from '../Conductor.module.css'

export function ConductorMessageQueue({
  messages,
  editingMessageId,
  selectedMessageId,
  onEdit,
  onRemove,
  onMoveUp,
}: {
  messages: readonly QueuedAgentMessage[]
  editingMessageId?: string | null
  selectedMessageId?: string | null
  onEdit: (messageId: string) => void
  onRemove: (messageId: string) => void
  onMoveUp: (messageId: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const listId = useId()

  useEffect(() => {
    if (!removingId) return
    const timer = window.setTimeout(() => setRemovingId(null), 160)
    return () => window.clearTimeout(timer)
  }, [removingId])

  useEffect(() => {
    if (selectedMessageId) {
      setExpanded(true)
    }
  }, [selectedMessageId])

  if (messages.length === 0) return null

  const countLabel =
    messages.length === 1 ? '1 queued message' : `${messages.length} queued messages`

  return (
    <div
      className={styles.composerQueuePanel}
      data-testid="conductor-message-queue"
      data-queue-expanded={expanded ? 'true' : 'false'}
      data-queue-count={messages.length}
    >
      <button
        type="button"
        className={styles.composerQueuePanelHeader}
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={styles.composerQueueCount}>{countLabel}</span>
        <span className={styles.composerQueueChevron} aria-hidden>
          <ChevronIcon />
        </span>
      </button>

      {expanded ? (
        <ul id={listId} className={styles.composerQueueList} role="list">
          {messages.map((message, index) => {
            const editing = editingMessageId === message.id
            const selected = selectedMessageId === message.id
            const exiting = removingId === message.id
            return (
              <li
                key={message.id}
                className={[
                  styles.composerQueueListItem,
                  editing ? styles.composerQueueListItemEditing : '',
                  selected ? styles.composerQueueListItemSelected : '',
                  exiting ? styles.composerQueueListItemExit : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-testid="conductor-message-queue-row"
                data-editing={editing ? 'true' : undefined}
                data-selected={selected ? 'true' : undefined}
                aria-current={selected ? 'true' : undefined}
              >
                <button
                  type="button"
                  className={styles.composerQueueListMain}
                  onClick={() => onEdit(message.id)}
                  title="Edit in composer"
                >
                  {message.mode === 'steer' ? (
                    <span
                      className={`${styles.composerChip} ${styles.composerChipWarm} ${styles.composerQueueSteerChip}`}
                    >
                      Steer
                    </span>
                  ) : null}
                  <span className={styles.composerQueueListContent}>
                    {message.attachments?.length ? (
                      <span className={styles.composerQueueAttachments} aria-label="Attached images">
                        {message.attachments.map((attachment) => (
                          <img
                            alt={attachment.name}
                            className={styles.composerQueueAttachmentPreview}
                            key={attachment.id}
                            src={`data:${attachment.mimeType};base64,${attachment.data}`}
                          />
                        ))}
                      </span>
                    ) : null}
                    <span className={styles.composerQueueListText}>
                      {message.text || 'Image attachment'}
                    </span>
                  </span>
                </button>
                <div className={styles.composerQueueListActions}>
                  {index > 0 ? (
                    <button
                      type="button"
                      className={styles.composerQueueIconAction}
                      aria-label="Move up"
                      title="Move up"
                      onClick={(e) => {
                        e.stopPropagation()
                        onMoveUp(message.id)
                      }}
                    >
                      <MoveUpIcon />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.composerQueueAction}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit(message.id)
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={`${styles.composerQueueAction} ${styles.composerQueueActionDanger}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setRemovingId(message.id)
                      window.setTimeout(() => onRemove(message.id), 160)
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MoveUpIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
      <path d="M8 12V4" strokeLinecap="round" />
      <path d="m4.5 7.5 3.5-3.5 3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
