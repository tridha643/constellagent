import { ArrowSquareOut } from '@phosphor-icons/react'
import {
  linearOpenExternal,
  type LinearProjectUpdateNode,
} from '../../linear/linear-api'
import { Tooltip } from '../Tooltip/Tooltip'
import styles from './UpdateCard.module.css'

interface UpdateCardProps {
  update: LinearProjectUpdateNode
}

type HealthTone = 'on-track' | 'at-risk' | 'off-track' | 'unknown'

function resolveHealth(raw?: string | null): {
  label: string
  tone: HealthTone
} | null {
  if (!raw) return null
  const key = raw.trim()
  if (key === 'onTrack') return { label: 'On track', tone: 'on-track' }
  if (key === 'atRisk') return { label: 'At risk', tone: 'at-risk' }
  if (key === 'offTrack') return { label: 'Off track', tone: 'off-track' }
  return { label: key, tone: 'unknown' }
}

function initialsFor(name: string | undefined | null): string {
  if (!name) return '??'
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const ini = parts
    .map((p) => p[0]?.toUpperCase() ?? '')
    .filter(Boolean)
    .join('')
  return ini || name.slice(0, 2).toUpperCase()
}

function formatRelative(iso: string | undefined | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const delta = Date.now() - t
  const sec = Math.round(delta / 1000)
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.round(hr / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(months / 12)}y ago`
}

function formatAbsolute(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleString()
}

/**
 * Single Linear project update rendered as a floating card. Used in the
 * Updates tab timeline and anywhere a compact update preview is needed.
 */
export function UpdateCard({ update }: UpdateCardProps) {
  const author = update.user?.displayName?.trim() || update.user?.name || 'Unknown'
  const health = resolveHealth(update.health)
  const body = (update.body ?? '').trim()
  const relative = formatRelative(update.createdAt)
  const absolute = formatAbsolute(update.createdAt)
  const initials = initialsFor(author)

  return (
    <article className={styles.card} data-testid="linear-update-card">
      <header className={styles.header}>
        <Tooltip label={author}>
          <span className={styles.avatar} aria-label={author}>
            {initials}
          </span>
        </Tooltip>
        <div className={styles.headerText}>
          <span className={styles.author}>{author}</span>
          <span className={styles.timeRow}>
            {relative ? (
              <time className={styles.time} title={absolute} dateTime={update.createdAt}>
                {relative}
              </time>
            ) : null}
            {health ? (
              <span className={styles.health} data-tone={health.tone}>
                {health.label}
              </span>
            ) : null}
          </span>
        </div>
        {update.url ? (
          <Tooltip label="Open in Linear">
            <button
              type="button"
              className={styles.openBtn}
              onClick={() => void linearOpenExternal(update.url)}
              aria-label="Open update in Linear"
            >
              <ArrowSquareOut size={13} aria-hidden weight="regular" />
            </button>
          </Tooltip>
        ) : null}
      </header>
      {body ? <p className={styles.body}>{body}</p> : null}
    </article>
  )
}
