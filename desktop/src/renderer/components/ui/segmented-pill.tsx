import type { ReactNode } from 'react'
import { useCallback, useRef, useState } from 'react'
import { computeReorder, type DropSide } from './compute-reorder'
import styles from './segmented-pill.module.css'

export interface SegmentedPillTab {
  id: string
  label: string
  icon?: ReactNode
}

export interface SegmentedPillProps {
  tabs: SegmentedPillTab[]
  activeId: string
  onChange: (id: string) => void
  onReorder?: (nextIds: string[]) => void
  /** Accessible label for the tablist */
  ariaLabel: string
  className?: string
  'data-testid'?: string
}

const MIME = 'application/x-segmented-pill-tab'

export function SegmentedPill({
  tabs,
  activeId,
  onChange,
  onReorder,
  ariaLabel,
  className,
  'data-testid': testId,
}: SegmentedPillProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropOverId, setDropOverId] = useState<string | null>(null)
  const [dropSide, setDropSide] = useState<DropSide | null>(null)
  const segmentRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  const orderIds = tabs.map((t) => t.id)

  const handleDragStart = useCallback(
    (e: React.DragEvent, id: string) => {
      if (!onReorder) return
      e.dataTransfer.setData(MIME, id)
      e.dataTransfer.effectAllowed = 'move'
      setDraggingId(id)
    },
    [onReorder],
  )

  const handleDragEnd = useCallback(() => {
    setDraggingId(null)
    setDropOverId(null)
    setDropSide(null)
  }, [])

  const updateDropTarget = useCallback(
    (e: React.DragEvent, overId: string) => {
      if (!onReorder || !draggingId) return
      const el = segmentRefs.current.get(overId)
      if (!el) return
      const rect = el.getBoundingClientRect()
      const mid = rect.left + rect.width / 2
      const side: DropSide = e.clientX < mid ? 'before' : 'after'
      setDropOverId(overId)
      setDropSide(side)
    },
    [onReorder, draggingId],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent, overId: string) => {
      if (!onReorder || !draggingId) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      updateDropTarget(e, overId)
    },
    [onReorder, draggingId, updateDropTarget],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent, overId: string) => {
      if (!onReorder) return
      e.preventDefault()
      const raw = e.dataTransfer.getData(MIME)
      const draggedId = raw || draggingId
      if (!draggedId || draggedId === overId) {
        handleDragEnd()
        return
      }
      const el = segmentRefs.current.get(overId)
      let side: DropSide = 'before'
      if (el) {
        const rect = el.getBoundingClientRect()
        const mid = rect.left + rect.width / 2
        side = e.clientX < mid ? 'before' : 'after'
      }
      const next = computeReorder(orderIds, draggedId, overId, side)
      onReorder(next)
      handleDragEnd()
    },
    [onReorder, orderIds, draggingId, handleDragEnd],
  )

  return (
    <div
      className={[styles.track, className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId
        const showDropLeft = onReorder && dropOverId === tab.id && dropSide === 'before'
        const showDropRight = onReorder && dropOverId === tab.id && dropSide === 'after'
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) segmentRefs.current.set(tab.id, el)
              else segmentRefs.current.delete(tab.id)
            }}
            type="button"
            role="tab"
            id={`segmented-pill-${tab.id}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            draggable={Boolean(onReorder)}
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, tab.id)}
            onDrop={(e) => handleDrop(e, tab.id)}
            className={`${styles.segment} ${isActive ? styles.segmentActive : ''}`}
            data-drop-left={showDropLeft ? '' : undefined}
            data-drop-right={showDropRight ? '' : undefined}
            onClick={() => onChange(tab.id)}
          >
            <span className={styles.segmentWell}>
              {tab.icon ? <span className={styles.icon}>{tab.icon}</span> : null}
              <span className={styles.label}>{tab.label}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
