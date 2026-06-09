import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  CheckCircle2,
  XCircle,
  Clock,
  MinusCircle,
  Circle,
  ChevronDown,
  ExternalLink,
  GitCommitHorizontal,
} from 'lucide-react'
import type { CheckRowStatus, GithubLookupError, PrChecksDetail } from '@shared/github-types'
import type { UsePrChecksResult } from '../../hooks/usePrChecks'
import { MarkdownBody } from '../Markdown/MarkdownBody'
import styles from './Checks.module.css'

/** Collapsed height (px) of the PR description before "Show more" appears. */
const PR_BODY_COLLAPSED = 220

function StatusIcon({ status, size = 15 }: { status: CheckRowStatus; size?: number }) {
  switch (status) {
    case 'passing':
      return <CheckCircle2 size={size} className={styles.iconPassing} aria-label="passing" />
    case 'failing':
      return <XCircle size={size} className={styles.iconFailing} aria-label="failing" />
    case 'pending':
      return <Clock size={size} className={styles.iconPending} aria-label="pending" />
    case 'skipped':
      return <MinusCircle size={size} className={styles.iconSkipped} aria-label="skipped" />
    case 'neutral':
    default:
      return <Circle size={size} className={styles.iconNeutral} aria-label="neutral" />
  }
}

function openExternal(url: string | undefined) {
  if (!url) return
  // Route through window.open → main's setWindowOpenHandler → shell.openExternal.
  // This is the same gate-free path markdown links use; the IPC `app.openExternal`
  // handler runs an allow-list in the main process that needs a full restart to pick
  // up changes, so prefer the path that works immediately for arbitrary PR/CI URLs.
  window.open(url, '_blank', 'noopener,noreferrer')
}

function lookupErrorMessage(error: GithubLookupError): string {
  switch (error) {
    case 'gh_not_installed':
      return 'GitHub CLI (gh) is not installed — checks are unavailable.'
    case 'not_authenticated':
      return 'GitHub CLI is not authenticated. Run `gh auth login` to see checks.'
    case 'not_github_repo':
      return 'This workspace is not a GitHub repository.'
    default:
      return 'Checks are unavailable.'
  }
}

export function ChecksPanel({ checks }: { checks: UsePrChecksResult }) {
  const { detail, loading, error, hasBranch, noPr } = checks

  const body = useMemo(() => {
    if (error) {
      return <div className={styles.notice}>{lookupErrorMessage(error)}</div>
    }
    if (!hasBranch) {
      return <div className={styles.notice}>No branch checked out for this workspace.</div>
    }
    if (detail) {
      return <ChecksDetailView detail={detail} />
    }
    if (noPr) {
      return <div className={styles.notice}>No pull request for this branch.</div>
    }
    if (loading) {
      return <div className={styles.spinner}>Loading checks…</div>
    }
    return <div className={styles.notice}>No pull request for this branch.</div>
  }, [detail, loading, error, hasBranch, noPr])

  return <div className={styles.section}>{body}</div>
}

/**
 * PR description rendered as a readable markdown surface. Long bodies collapse behind a
 * fade + "Show more" toggle (no nested scrollbar), expanding to their measured height so
 * the reveal animates smoothly. Falls back to full height when content fits.
 */
function PrDescription({ body }: { body: string }) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [fullHeight, setFullHeight] = useState(0)
  const [expanded, setExpanded] = useState(false)

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    const measure = () => setFullHeight(el.scrollHeight)
    measure()
    // ProseMark (CodeMirror) settles its height after mount; observe the inner content
    // so we re-measure as it reflows.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [body])

  const overflows = fullHeight > PR_BODY_COLLAPSED + 8
  const collapsed = overflows && !expanded
  const maxHeight = collapsed ? PR_BODY_COLLAPSED : overflows ? fullHeight : undefined

  return (
    <div className={styles.prBody} data-testid="checks-pr-body">
      <div className={styles.prBodyClip} style={{ maxHeight }}>
        <div ref={innerRef} className={styles.prBodyInner}>
          <MarkdownBody content={body} className={styles.prBodyMarkdown} />
        </div>
      </div>
      {overflows && (
        <button
          type="button"
          className={`${styles.prBodyToggle} ${collapsed ? styles.prBodyToggleOverlay : ''}`}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
          <ChevronDown
            size={13}
            className={`${styles.prBodyChevron} ${expanded ? styles.prBodyChevronUp : ''}`}
          />
        </button>
      )}
    </div>
  )
}

/** A single check / deployment row. Whole row opens its details URL when present. */
function ListRow({
  status,
  name,
  sub,
  duration,
  url,
  title,
}: {
  status: CheckRowStatus
  name: string
  sub?: string | null
  duration?: string | null
  url?: string | null
  title: string
}) {
  const clickable = !!url
  return (
    <div
      className={`${styles.row} ${clickable ? styles.rowClickable : ''}`}
      {...(clickable
        ? {
            role: 'button' as const,
            tabIndex: 0,
            title,
            onClick: () => openExternal(url),
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                openExternal(url)
              }
            },
          }
        : {})}
    >
      <span className={styles.rowIcon}>
        <StatusIcon status={status} />
      </span>
      <span className={styles.rowName}>
        {name}
        {sub && <span className={styles.rowApp}> · {sub}</span>}
      </span>
      {duration && <span className={styles.rowDuration}>{duration}</span>}
      {clickable && <ExternalLink size={13} className={styles.rowChevron} aria-hidden />}
    </div>
  )
}

function ChecksDetailView({ detail }: { detail: PrChecksDetail }) {
  const allPassed = detail.total > 0 && detail.failedCount === 0
  const headerText =
    detail.total === 0
      ? 'No checks'
      : detail.failedCount > 0
        ? `${detail.failedCount} / ${detail.total} checks failed`
        : 'All checks passed'

  return (
    <>
      <div className={styles.prHeaderRow}>
        <button
          type="button"
          className={styles.prPill}
          onClick={() => openExternal(detail.url)}
          title="Open pull request"
        >
          #{detail.number}
          <ExternalLink size={11} />
        </button>
        <span
          className={`${styles.statusHeader} ${
            detail.failedCount > 0 ? styles.statusHeaderFail : styles.statusHeaderPass
          }`}
        >
          <StatusIcon
            status={detail.total === 0 ? 'neutral' : allPassed ? 'passing' : 'failing'}
            size={14}
          />
          {headerText}
        </span>
        <span className={styles.headerSpacer} />
        <button
          type="button"
          className={styles.viewChecksButton}
          onClick={() => openExternal(`${detail.url}/checks`)}
        >
          View checks
          <ExternalLink size={12} />
        </button>
      </div>

      {detail.title && <h2 className={styles.prTitle}>{detail.title}</h2>}
      {detail.body && detail.body.trim() && <PrDescription body={detail.body} />}

      {detail.commitsBehind !== null && detail.commitsBehind > 0 && (
        <div className={styles.gitStatusRow}>
          <GitCommitHorizontal size={13} />
          {detail.commitsBehind} commit{detail.commitsBehind === 1 ? '' : 's'} behind{' '}
          {detail.baseRefName}
        </div>
      )}

      {detail.deployments.length > 0 && (
        <div className={styles.section}>
          <span className={styles.listLabel}>Deployments</span>
          <div className={styles.list}>
            {detail.deployments.map((deployment) => (
              <ListRow
                key={deployment.id}
                status={deployment.status}
                name={deployment.environment}
                url={deployment.url}
                title="Open deployment"
              />
            ))}
          </div>
        </div>
      )}

      <div className={styles.section}>
        <span className={styles.listLabel}>Checks</span>
        {detail.checks.length === 0 ? (
          <div className={styles.notice}>No checks</div>
        ) : (
          <div className={styles.list}>
            {detail.checks.map((check) => (
              <ListRow
                key={check.id}
                status={check.status}
                name={check.name}
                sub={check.appName}
                duration={check.durationLabel}
                url={check.detailsUrl}
                title="Open check details"
              />
            ))}
            {detail.truncatedCount > 0 && (
              <div className={styles.truncatedNote}>+ {detail.truncatedCount} more not shown</div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
