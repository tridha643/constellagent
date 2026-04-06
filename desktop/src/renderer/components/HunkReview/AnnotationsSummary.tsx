import { useState, useCallback, useMemo, type MouseEvent } from 'react'
import type { DiffAnnotation } from '../../../shared/diff-annotation-types'
import { annotationLineEnd } from '../../../shared/diff-annotation-types'
import { useAppStore } from '../../store/app-store'
import styles from './AnnotationsSummary.module.css'

interface Props {
  annotations: DiffAnnotation[]
  worktreePath: string
  onAnnotationsChanged: () => void
  selectedIds: Set<string>
  onToggleComment: (id: string) => void
  onJumpToAnnotation: (annotation: DiffAnnotation) => void
}

interface GroupedAnnotations {
  filePath: string
  annotations: DiffAnnotation[]
}

function groupByFile(annotations: DiffAnnotation[]): GroupedAnnotations[] {
  const map = new Map<string, DiffAnnotation[]>()
  for (const a of annotations) {
    const list = map.get(a.filePath)
    if (list) list.push(a)
    else map.set(a.filePath, [a])
  }
  return Array.from(map.entries()).map(([filePath, anns]) => ({
    filePath,
    annotations: anns.sort((a, b) => a.lineNumber - b.lineNumber),
  }))
}

const AVATAR_COLORS: Record<string, { bg: string; text: string }> = {
  you: { bg: 'rgba(59, 130, 246, 0.2)', text: 'rgb(147, 197, 253)' },
  cursor: { bg: 'rgba(168, 85, 247, 0.2)', text: 'rgb(192, 132, 252)' },
  'claude-code': { bg: 'rgba(251, 146, 60, 0.2)', text: 'rgb(253, 186, 116)' },
  codex: { bg: 'rgba(52, 211, 153, 0.2)', text: 'rgb(110, 231, 183)' },
  gemini: { bg: 'rgba(56, 189, 248, 0.2)', text: 'rgb(125, 211, 252)' },
}

function getAvatarStyle(name: string) {
  const key = name.toLowerCase()
  if (AVATAR_COLORS[key]) return AVATAR_COLORS[key]
  const hash = key.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const hue = hash % 360
  return { bg: `hsla(${hue}, 60%, 50%, 0.2)`, text: `hsl(${hue}, 70%, 75%)` }
}

function formatTimeAgo(isoDate: string): string {
  if (!isoDate) return ''
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

function AnnotationRow({
  annotation,
  worktreePath,
  onChanged,
  selected,
  onToggle,
  onJumpToAnnotation,
}: {
  annotation: DiffAnnotation
  worktreePath: string
  onChanged: () => void
  selected?: boolean
  onToggle?: (id: string) => void
  onJumpToAnnotation: (annotation: DiffAnnotation) => void
}) {
  const [busy, setBusy] = useState(false)
  const addToast = useAppStore((s) => s.addToast)
  const isAgent = !!annotation.author
  const isGithub = annotation.id.startsWith('PRR') || annotation.id.startsWith('IC_')
  const end = annotationLineEnd(annotation)
  const lineLabel =
    end !== annotation.lineNumber ? `L${annotation.lineNumber}–${end}` : `L${annotation.lineNumber}`
  const sideLabel = annotation.side === 'additions' ? 'new' : 'old'

  const displayName = isAgent ? annotation.author! : isGithub ? annotation.author! : 'You'
  const initial = displayName.charAt(0).toUpperCase()
  const avatarStyle = useMemo(() => getAvatarStyle(displayName), [displayName])
  const timeAgo = useMemo(() => formatTimeAgo(annotation.createdAt), [annotation.createdAt])

  const handleResolve = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.api.review.commentResolve(worktreePath, annotation.id, !annotation.resolved)
      onChanged()
    } catch (e) {
      addToast({ id: `ann-resolve-${Date.now()}`, message: 'Failed to resolve', type: 'error' })
    } finally {
      setBusy(false)
    }
  }, [busy, worktreePath, annotation.id, annotation.resolved, onChanged, addToast])

  const handleDelete = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.api.review.commentRemove(worktreePath, annotation.id)
      onChanged()
    } catch (e) {
      addToast({ id: `ann-delete-${Date.now()}`, message: 'Failed to delete', type: 'error' })
    } finally {
      setBusy(false)
    }
  }, [busy, worktreePath, annotation.id, onChanged, addToast])

  const jump = useCallback(() => {
    onJumpToAnnotation(annotation)
  }, [annotation, onJumpToAnnotation])

  const handleRowClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button, input')) return
      jump()
    },
    [jump],
  )

  return (
    <div
      className={`${styles.row} ${annotation.resolved ? styles.resolved : ''}`}
      onClick={handleRowClick}
    >
      <div className={styles.rowInner}>
        <div
          className={styles.rowAvatar}
          style={{ backgroundColor: avatarStyle.bg, color: avatarStyle.text }}
        >
          {initial}
        </div>
        <div className={styles.rowContent}>
          <div className={styles.rowHeader}>
            {!isAgent && !isGithub && onToggle && (
              <input
                type="checkbox"
                checked={!!selected}
                onChange={() => onToggle(annotation.id)}
                className={styles.checkbox}
              />
            )}
            <span className={styles.authorName} style={{ color: avatarStyle.text }}>
              {displayName}
            </span>
            {timeAgo && <span className={styles.timestamp}>{timeAgo}</span>}
            <button
              type="button"
              className={styles.lineLink}
              onClick={(e) => {
                e.stopPropagation()
                jump()
              }}
              title="Jump to this annotation in the diff"
            >
              {lineLabel}
              <span className={styles.lineSide}>{sideLabel}</span>
            </button>
            {annotation.resolved && <span className={styles.resolvedBadge}>Resolved</span>}
          </div>
          <p className={styles.body}>{annotation.body}</p>
          {!isGithub && (
            <div className={styles.actions}>
              <button
                type="button"
                onClick={() => void handleResolve()}
                disabled={busy}
                className={`${styles.actionBtn} ${annotation.resolved ? styles.unresolveBtn : styles.resolveBtn}`}
              >
                {annotation.resolved ? 'Unresolve' : 'Resolve'}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={busy}
                className={`${styles.actionBtn} ${styles.deleteBtn}`}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function AnnotationsSummary({
  annotations,
  worktreePath,
  onAnnotationsChanged,
  selectedIds,
  onToggleComment,
  onJumpToAnnotation,
}: Props) {
  const [collapsed, setCollapsed] = useState(false)

  const grouped = useMemo(() => groupByFile(annotations), [annotations])
  const agentCount = useMemo(() => annotations.filter((a) => !!a.author).length, [annotations])
  const humanCount = annotations.length - agentCount

  if (annotations.length === 0) return null

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={styles.sectionHeader}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className={styles.chevron}>{collapsed ? '\u25B6' : '\u25BC'}</span>
        <span className={styles.sectionTitle}>Annotations</span>
        <span className={styles.countBadge}>{annotations.length}</span>
        {agentCount > 0 && (
          <span className={styles.agentCountBadge}>{agentCount} agent</span>
        )}
        {humanCount > 0 && (
          <span className={styles.humanCountBadge}>{humanCount} human</span>
        )}
      </button>
      {!collapsed && (
        <div className={styles.list}>
          {grouped.map((group) => (
            <div key={group.filePath} className={styles.fileGroup}>
              <div className={styles.fileHeader}>
                <span className={styles.fileIcon}>&#128196;</span>
                <span className={styles.fileName}>{group.filePath}</span>
                <span className={styles.fileCount}>{group.annotations.length}</span>
              </div>
              {group.annotations.map((a) => (
                <AnnotationRow
                  key={a.id}
                  annotation={a}
                  worktreePath={worktreePath}
                  onChanged={onAnnotationsChanged}
                  selected={selectedIds.has(a.id)}
                  onToggle={onToggleComment}
                  onJumpToAnnotation={onJumpToAnnotation}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
