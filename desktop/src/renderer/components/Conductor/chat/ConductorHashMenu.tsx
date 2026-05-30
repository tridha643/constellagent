import { useEffect, useRef } from 'react'
import type { OpenPrInfo } from '../../../../shared/github-types'
import { prComposerBranchLabel } from '../../../../shared/composer-hash-mention'
import { PrOpenIcon } from './composer-pr-icon'
import styles from '../Conductor.module.css'

export function ConductorHashMenu({
  prs,
  selectedPr,
  loading,
  refreshing,
  error,
  onSelect,
}: {
  prs: readonly OpenPrInfo[]
  selectedPr: OpenPrInfo | undefined
  loading: boolean
  refreshing?: boolean
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
        <>
          {refreshing ? (
            <div className={styles.conductorHashMenuStatus}>Refreshing…</div>
          ) : null}
          {prs.map((pr) => {
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
          })}
        </>
      )}
    </div>
  )
}
