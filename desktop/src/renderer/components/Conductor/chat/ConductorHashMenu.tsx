import { useEffect, useRef } from 'react'
import type { OpenPrInfo } from '../../../../shared/github-types'
import { prComposerBranchLabel } from '../../../../shared/composer-hash-mention'
import styles from '../Conductor.module.css'

const PR_ICON_SIZE = 14

function PrOpenIcon() {
  return (
    <svg width={PR_ICON_SIZE} height={PR_ICON_SIZE} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
    </svg>
  )
}

export function ConductorHashMenu({
  prs,
  selectedPr,
  loading,
  error,
  onSelect,
}: {
  prs: readonly OpenPrInfo[]
  selectedPr: OpenPrInfo | undefined
  loading: boolean
  error: string | null
  onSelect: (pr: OpenPrInfo) => void
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedPr?.number])

  return (
    <div className={styles.conductorHashMenu} data-testid="conductor-hash-menu">
      {loading ? (
        <div className={styles.conductorHashMenuStatus}>Loading open pull requests…</div>
      ) : error ? (
        <div className={styles.conductorHashMenuStatus}>{error}</div>
      ) : prs.length === 0 ? (
        <div className={styles.conductorHashMenuStatus}>No matching open pull requests.</div>
      ) : (
        prs.map((pr) => {
          const active = selectedPr?.number === pr.number
          const branch = prComposerBranchLabel(pr)
          return (
            <button
              key={pr.number}
              ref={active ? activeRef : undefined}
              type="button"
              className={styles.conductorHashMenuItem}
              data-active={active ? 'true' : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(pr)}
            >
              <span className={styles.conductorHashMenuIcon}>
                <PrOpenIcon />
              </span>
              <span className={styles.conductorHashMenuToken}>#{pr.number}</span>
              <span className={styles.conductorHashMenuTitle}>{pr.title}</span>
              <span className={styles.conductorHashMenuBranch}>{branch}</span>
            </button>
          )
        })
      )}
    </div>
  )
}
