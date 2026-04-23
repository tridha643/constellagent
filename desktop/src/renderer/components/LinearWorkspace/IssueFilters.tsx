import { MagnifyingGlass, Rows, SquaresFour, X } from '@phosphor-icons/react'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import {
  EMPTY_LINEAR_ISSUE_FILTERS,
  LINEAR_ISSUE_STATE_TYPES,
  type LinearIssueDensity,
  type LinearIssueFilters,
  type LinearIssueScope,
  type LinearIssueStateType,
} from '../../store/types'
import { Tooltip } from '../Tooltip/Tooltip'
import { priorityLabel } from './PriorityGlyph'
import { LINEAR_ISSUE_STATE_LABELS } from './group-issues-by-state'
import styles from './IssueFilters.module.css'

interface IssueFiltersProps {
  scope: LinearIssueScope
  onScopeChange: (next: LinearIssueScope) => void
  filters: LinearIssueFilters
  onFiltersChange: (next: LinearIssueFilters) => void
  density: LinearIssueDensity
  onDensityChange: (next: LinearIssueDensity) => void
  /** Available team keys (derived from issues/teams list). */
  availableTeamKeys: string[]
}

const PRIORITY_OPTIONS: number[] = [1, 2, 3, 4, 0]

export interface IssueFiltersHandle {
  focusSearch: () => void
}

/**
 * Chip-style client-side filter bar for the Issues list. Multi-select chips
 * are shown inline up to the container width; narrower viewports collapse
 * Team/Priority/State into a single "More filters" popover.
 */
export const IssueFilters = forwardRef<IssueFiltersHandle, IssueFiltersProps>(
  function IssueFilters(
    {
      scope,
      onScopeChange,
      filters,
      onFiltersChange,
      density,
      onDensityChange,
      availableTeamKeys,
    },
    ref,
  ) {
    const searchRef = useRef<HTMLInputElement>(null)
    const [menuOpen, setMenuOpen] = useState<null | 'priority' | 'state' | 'team'>(
      null,
    )
    const rootRef = useRef<HTMLDivElement>(null)

    const focusSearch = useCallback(() => {
      searchRef.current?.focus()
      searchRef.current?.select()
    }, [])

    useEffect(() => {
      if (typeof ref === 'function') {
        ref({ focusSearch })
      } else if (ref) {
        ref.current = { focusSearch }
      }
    }, [ref, focusSearch])

    useEffect(() => {
      if (!menuOpen) return
      const onDown = (e: MouseEvent) => {
        if (rootRef.current?.contains(e.target as Node)) return
        setMenuOpen(null)
      }
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setMenuOpen(null)
      }
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
      return () => {
        document.removeEventListener('mousedown', onDown)
        document.removeEventListener('keydown', onKey)
      }
    }, [menuOpen])

    const togglePriority = (p: number) => {
      const set = new Set(filters.priorities)
      set.has(p) ? set.delete(p) : set.add(p)
      onFiltersChange({ ...filters, priorities: [...set].sort((a, b) => a - b) })
    }

    const toggleStateType = (st: LinearIssueStateType) => {
      const set = new Set(filters.stateTypes)
      set.has(st) ? set.delete(st) : set.add(st)
      onFiltersChange({ ...filters, stateTypes: [...set] })
    }

    const toggleTeam = (key: string) => {
      const set = new Set(filters.teamKeys)
      set.has(key) ? set.delete(key) : set.add(key)
      onFiltersChange({ ...filters, teamKeys: [...set].sort() })
    }

    const activeCount =
      filters.priorities.length +
      filters.stateTypes.length +
      filters.teamKeys.length +
      (filters.text.trim() ? 1 : 0)

    const clear = () =>
      onFiltersChange({ ...EMPTY_LINEAR_ISSUE_FILTERS, text: '' })

    return (
      <div className={styles.root} ref={rootRef}>
        <div className={styles.segment} role="tablist" aria-label="Issue scope">
          <button
            type="button"
            className={styles.segBtn}
            data-active={scope === 'assigned'}
            role="tab"
            aria-selected={scope === 'assigned'}
            onClick={() => onScopeChange('assigned')}
          >
            Assigned to me
          </button>
          <button
            type="button"
            className={styles.segBtn}
            data-active={scope === 'created'}
            role="tab"
            aria-selected={scope === 'created'}
            onClick={() => onScopeChange('created')}
          >
            Created by me
          </button>
        </div>

        <label className={styles.searchWrap}>
          <MagnifyingGlass size={12} aria-hidden className={styles.searchIcon} />
          <input
            ref={searchRef}
            type="text"
            className={styles.searchInput}
            placeholder="Filter issues…"
            aria-label="Filter issues by text"
            value={filters.text}
            onChange={(e) => onFiltersChange({ ...filters, text: e.target.value })}
          />
          {filters.text ? (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => onFiltersChange({ ...filters, text: '' })}
              aria-label="Clear search"
            >
              <X size={10} aria-hidden weight="bold" />
            </button>
          ) : null}
        </label>

        <div className={styles.chipGroup}>
          <ChipMenu
            label="Priority"
            activeCount={filters.priorities.length}
            open={menuOpen === 'priority'}
            onOpenChange={(next) => setMenuOpen(next ? 'priority' : null)}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <CheckItem
                key={p}
                checked={filters.priorities.includes(p)}
                label={priorityLabel(p)}
                onClick={() => togglePriority(p)}
              />
            ))}
          </ChipMenu>

          <ChipMenu
            label="State"
            activeCount={filters.stateTypes.length}
            open={menuOpen === 'state'}
            onOpenChange={(next) => setMenuOpen(next ? 'state' : null)}
          >
            {LINEAR_ISSUE_STATE_TYPES.map((st) => (
              <CheckItem
                key={st}
                checked={filters.stateTypes.includes(st)}
                label={LINEAR_ISSUE_STATE_LABELS[st]}
                onClick={() => toggleStateType(st)}
              />
            ))}
          </ChipMenu>

          {availableTeamKeys.length > 0 ? (
            <ChipMenu
              label="Team"
              activeCount={filters.teamKeys.length}
              open={menuOpen === 'team'}
              onOpenChange={(next) => setMenuOpen(next ? 'team' : null)}
            >
              {availableTeamKeys.map((key) => (
                <CheckItem
                  key={key}
                  checked={filters.teamKeys.includes(key)}
                  label={key}
                  onClick={() => toggleTeam(key)}
                />
              ))}
            </ChipMenu>
          ) : null}
        </div>

        <div className={styles.trailing}>
          {activeCount > 0 ? (
            <button
              type="button"
              className={styles.clearLink}
              onClick={clear}
              aria-label="Clear all filters"
            >
              Clear
            </button>
          ) : null}
          <div
            className={styles.densityToggle}
            role="group"
            aria-label="Row density"
          >
            <Tooltip label="Comfortable">
              <button
                type="button"
                className={styles.densityBtn}
                data-active={density === 'comfortable'}
                onClick={() => onDensityChange('comfortable')}
                aria-pressed={density === 'comfortable'}
                aria-label="Comfortable density"
              >
                <SquaresFour size={12} aria-hidden weight="duotone" />
              </button>
            </Tooltip>
            <Tooltip label="Compact">
              <button
                type="button"
                className={styles.densityBtn}
                data-active={density === 'compact'}
                onClick={() => onDensityChange('compact')}
                aria-pressed={density === 'compact'}
                aria-label="Compact density"
              >
                <Rows size={12} aria-hidden weight="duotone" />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    )
  },
)

interface ChipMenuProps {
  label: string
  activeCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

function ChipMenu({ label, activeCount, open, onOpenChange, children }: ChipMenuProps) {
  return (
    <div className={styles.chipMenu}>
      <button
        type="button"
        className={styles.chip}
        data-active={activeCount > 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <span className={styles.chipLabel}>{label}</span>
        {activeCount > 0 ? (
          <span className={styles.chipCount}>{activeCount}</span>
        ) : null}
        <span className={styles.chipChevron} aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className={styles.chipList} role="listbox" aria-label={label}>
          {children}
        </div>
      ) : null}
    </div>
  )
}

function CheckItem({
  checked,
  label,
  onClick,
}: {
  checked: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={checked}
      className={styles.chipItem}
      onClick={onClick}
    >
      <span className={styles.chipItemCheck} data-checked={checked} aria-hidden />
      <span className={styles.chipItemLabel}>{label}</span>
    </button>
  )
}
