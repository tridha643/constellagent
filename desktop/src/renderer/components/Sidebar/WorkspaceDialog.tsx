import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Project, GraphiteNewBranchSource } from '../../store/types'
import { parsePrUrl, parsePrNumber } from '../../../shared/pr-url'
import type { GraphiteCreateBranchOption } from '../../../shared/graphite-types'
import styles from './WorkspaceDialog.module.css'

/** Live-sanitize a string into a valid git branch name as the user types */
function toBranchName(input: string): string {
  return input
    .replace(/\s+/g, '-')
    .replace(/[\x00-\x1f\x7f~^:?*[\]\\]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/\/{2,}/g, '/')
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

interface Props {
  project: Project
  onConfirm: (
    name: string,
    branch: string,
    newBranch: boolean,
    baseBranch?: string,
    graphiteParentBranch?: string,
  ) => void
  onCancel: () => void
  isCreating?: boolean
  createProgressMessage?: string
  showSlowCreateMessage?: boolean
}

/** Check if a string looks like a PR reference (URL or #number) */
function isPrRef(value: string): boolean {
  return parsePrUrl(value) !== null || parsePrNumber(value) !== null
}

/** Extract PR info from a PR reference string */
function extractPrInfo(value: string): { number: number; repoSlug?: string } | null {
  const parsed = parsePrUrl(value)
  if (parsed) return { number: parsed.number, repoSlug: `${parsed.owner}/${parsed.repo}` }
  const num = parsePrNumber(value)
  if (num !== null) return { number: num }
  return null
}

export function WorkspaceDialog({
  project,
  onConfirm,
  onCancel,
  isCreating = false,
  createProgressMessage = '',
  showSlowCreateMessage = false,
}: Props) {
  const [name, setName] = useState(`ws-${Date.now().toString(36)}`)
  const [branches, setBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState('')
  const [isNewBranch, setIsNewBranch] = useState(true)
  const [newBranchName, setNewBranchName] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [graphiteTrunks, setGraphiteTrunks] = useState<string[]>([])
  const [graphiteBranches, setGraphiteBranches] = useState<GraphiteCreateBranchOption[]>([])
  const [graphiteSourceMode, setGraphiteSourceMode] = useState<GraphiteNewBranchSource>(
    project.graphiteNewBranchSource ?? 'trunk',
  )
  const [selectedGraphiteBranch, setSelectedGraphiteBranch] = useState('')
  const [loading, setLoading] = useState(true)
  const [prResolving, setPrResolving] = useState(false)
  const [prError, setPrError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [basePickerOpen, setBasePickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const basePickerRef = useRef<HTMLDivElement>(null)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    let cancelled = false

    const loadBranches = async () => {
      try {
        const [defaultBranchRef, b, graphiteOptions] = await Promise.all([
          window.api.git.getDefaultBranch(project.repoPath).catch(() => ''),
          window.api.git.getBranches(project.repoPath).catch(() => [] as string[]),
          window.api.graphite.getCreateOptions(project.repoPath).catch(() => null),
        ])
        if (cancelled) return

        const defaultBranch = defaultBranchRef.replace(/^origin\//, '')
        setBranches(b)
        setGraphiteBranches(graphiteOptions?.branches ?? [])

        const trunkOptions = uniqueNonEmpty([
          project.graphitePreferredTrunk,
          defaultBranch,
          ...(graphiteOptions?.trunks ?? []),
        ])
        setGraphiteTrunks(trunkOptions)

        if (defaultBranch && b.includes(defaultBranch)) {
          setSelectedBranch(defaultBranch)
        } else if (b.length > 0) {
          setSelectedBranch(b[0])
        }

        if (project.graphitePreferredTrunk && trunkOptions.includes(project.graphitePreferredTrunk)) {
          setBaseBranch(project.graphitePreferredTrunk)
        } else if (defaultBranch && trunkOptions.includes(defaultBranch)) {
          setBaseBranch(defaultBranch)
        } else if (trunkOptions.length > 0) {
          setBaseBranch(trunkOptions[0])
        } else if (defaultBranch) {
          setBaseBranch(defaultBranch)
        } else if (b.length > 0) {
          setBaseBranch(b[0])
        }

        if (graphiteOptions?.branches?.length) {
          setSelectedGraphiteBranch((prev) => prev || graphiteOptions.branches[0].name)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadBranches()
    return () => {
      cancelled = true
    }
  }, [project.repoPath, project.graphitePreferredTrunk])

  const graphiteEnabled = project.prLinkProvider === 'graphite'
    || !!project.graphitePreferredTrunk
    || graphiteBranches.length > 0

  const graphiteBranchGroups = useMemo(() => {
    const groups = new Map<string, GraphiteCreateBranchOption[]>()
    for (const branch of graphiteBranches) {
      const list = groups.get(branch.trunk) ?? []
      list.push(branch)
      groups.set(branch.trunk, list)
    }
    return Array.from(groups.entries())
  }, [graphiteBranches])

  /** Resolve a PR reference to its branch name via gh CLI */
  const resolvePr = useCallback(async (value: string, target: 'branch' | 'baseBranch') => {
    const prInfo = extractPrInfo(value)
    if (prInfo === null) return false

    setPrResolving(true)
    setPrError('')
    try {
      const result = await window.api.github.resolvePr(project.repoPath, prInfo.number, prInfo.repoSlug)
      if (target === 'branch') {
        setSelectedBranch(result.branch)
        setName(`pr-${result.number}`)
      } else {
        setBaseBranch(result.branch)
      }
      setPrError('')
      return true
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to resolve PR'
      setPrError(msg)
      return false
    } finally {
      setPrResolving(false)
    }
  }, [project.repoPath])

  const handleSubmit = useCallback(async () => {
    if (isCreating || prResolving) return
    const branch = isNewBranch ? (newBranchName || name) : selectedBranch
    let base = isNewBranch ? baseBranch : undefined
    let graphiteParentBranch: string | undefined

    if (isNewBranch && graphiteEnabled) {
      if (graphiteSourceMode === 'branch') {
        base = selectedGraphiteBranch || undefined
        graphiteParentBranch = selectedGraphiteBranch || undefined
      } else {
        graphiteParentBranch = baseBranch || undefined
      }
    }

    // Auto-resolve PR references on submit instead of passing raw URLs as branch names
    if (!isNewBranch && isPrRef(branch)) {
      const resolved = await resolvePr(branch, 'branch')
      // resolvePr updates selectedBranch on success; the user can then submit again
      if (!resolved) return
      // Don't proceed — let the user review the resolved branch and submit again
      return
    }
    if (isNewBranch && !graphiteEnabled && base && isPrRef(base)) {
      const resolved = await resolvePr(base, 'baseBranch')
      if (!resolved) return
      return
    }

    onConfirm(name, branch, isNewBranch, base, graphiteParentBranch)
  }, [
    name,
    isNewBranch,
    newBranchName,
    selectedBranch,
    baseBranch,
    onConfirm,
    isCreating,
    prResolving,
    resolvePr,
    graphiteEnabled,
    graphiteSourceMode,
    selectedGraphiteBranch,
  ])

  // Close pickers on click outside
  useEffect(() => {
    if (!pickerOpen && !basePickerOpen) return
    const handler = (e: MouseEvent) => {
      if (pickerOpen && pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
      if (basePickerOpen && basePickerRef.current && !basePickerRef.current.contains(e.target as Node)) {
        setBasePickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pickerOpen, basePickerOpen])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isCreating || exiting) return
    if (e.key === 'Escape') { animateExit(); return }

    if (e.key === 'Enter') {
      // If the focused input has a PR reference, resolve it instead of submitting
      const target = e.target as HTMLInputElement
      if (target.tagName === 'INPUT') {
        const value = target.value.trim()
        if (isPrRef(value)) {
          e.preventDefault()
          e.stopPropagation()
          // Determine which field is focused
          if (isNewBranch) {
            // In new-branch mode, only the base branch input can have a PR ref
            if (!graphiteEnabled) {
              resolvePr(value, 'baseBranch')
            }
          } else {
            // In existing-branch mode, the branch input can have a PR ref
            resolvePr(value, 'branch')
          }
          return
        }
      }
      handleSubmit()
    }
  }, [handleSubmit, isCreating, isNewBranch, resolvePr, exiting, graphiteEnabled])

  const animateExit = useCallback(() => {
    if (exiting || isCreating) return
    setExiting(true)
    setTimeout(() => onCancel(), 150)
  }, [exiting, isCreating, onCancel])

  const createDisabled = !name.trim()
    || isCreating
    || prResolving
    || (isNewBranch && graphiteEnabled && graphiteSourceMode === 'trunk' && !baseBranch.trim())
    || (isNewBranch && graphiteEnabled && graphiteSourceMode === 'branch' && !selectedGraphiteBranch.trim())

  return (
    <div className={`${styles.overlay} ${exiting ? styles.overlayExiting : ''}`} onClick={animateExit}>
      <div className={`${styles.dialog} ${exiting ? styles.dialogExiting : ''}`} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className={styles.title}>New Workspace</div>

        <label className={styles.label}>Name</label>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          disabled={isCreating}
          placeholder="workspace-name"
        />

        <label className={styles.label}>Branch</label>
        <div className={styles.branchToggle}>
          <button
            className={`${styles.toggleBtn} ${isNewBranch ? styles.active : ''}`}
            onClick={() => setIsNewBranch(true)}
            disabled={isCreating}
          >
            New branch
          </button>
          <button
            className={`${styles.toggleBtn} ${!isNewBranch ? styles.active : ''}`}
            onClick={() => setIsNewBranch(false)}
            disabled={isCreating}
          >
            Existing
          </button>
        </div>

        {isNewBranch ? (
          <>
            <input
              className={styles.input}
              value={newBranchName}
              onChange={(e) => setNewBranchName(toBranchName(e.target.value))}
              disabled={isCreating}
              placeholder={toBranchName(name) || 'branch-name'}
            />

            {graphiteEnabled ? (
              <>
                <label className={styles.label}>Create from</label>
                <div className={styles.branchToggle}>
                  <button
                    className={`${styles.toggleBtn} ${graphiteSourceMode === 'trunk' ? styles.active : ''}`}
                    onClick={() => setGraphiteSourceMode('trunk')}
                    disabled={isCreating || prResolving}
                    type="button"
                  >
                    Trunk
                  </button>
                  <button
                    className={`${styles.toggleBtn} ${graphiteSourceMode === 'branch' ? styles.active : ''}`}
                    onClick={() => setGraphiteSourceMode('branch')}
                    disabled={isCreating || prResolving || graphiteBranches.length === 0}
                    type="button"
                  >
                    Graphite branch
                  </button>
                </div>

                {graphiteSourceMode === 'trunk' ? (
                  <>
                    <label className={styles.label}>Trunk branch</label>
                    <select
                      className={styles.input}
                      value={baseBranch}
                      onChange={(e) => setBaseBranch(e.target.value)}
                      disabled={loading || isCreating || prResolving}
                    >
                      {graphiteTrunks.map((trunk) => (
                        <option key={trunk} value={trunk}>{trunk}</option>
                      ))}
                    </select>
                  </>
                ) : (
                  <>
                    <label className={styles.label}>Graphite source branch</label>
                    <select
                      className={styles.input}
                      value={selectedGraphiteBranch}
                      onChange={(e) => setSelectedGraphiteBranch(e.target.value)}
                      disabled={loading || isCreating || prResolving || graphiteBranches.length === 0}
                    >
                      {graphiteBranchGroups.map(([trunk, options]) => (
                        <optgroup key={trunk} label={`Trunk · ${trunk}`}>
                          {options.map((option) => (
                            <option key={option.name} value={option.name}>
                              {option.parent ? `${option.name} ← ${option.parent}` : option.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </>
                )}
              </>
            ) : (
              <>
                <label className={styles.label}>Base branch</label>
                <div className={styles.branchInputRow} ref={basePickerRef}>
                  <input
                    className={styles.input}
                    value={baseBranch}
                    onChange={(e) => { setBaseBranch(e.target.value); setPrError('') }}
                    disabled={loading || isCreating || prResolving}
                    placeholder="Branch name, PR URL, or #123 (press Enter to resolve)"
                  />
                  {prResolving && <span className={styles.prSpinner} />}
                  <button
                    className={styles.pickerBtn}
                    onClick={() => setBasePickerOpen((v) => !v)}
                    disabled={loading || isCreating || prResolving}
                    type="button"
                  >
                    &#9662;
                  </button>
                  {basePickerOpen && (
                    <div className={styles.pickerDropdown}>
                      {branches.map((b) => (
                        <div
                          key={b}
                          className={`${styles.pickerOption} ${b === baseBranch ? styles.pickerOptionActive : ''}`}
                          onClick={() => { setBaseBranch(b); setBasePickerOpen(false) }}
                        >
                          {b}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {prError && <div className={styles.prError}>{prError}</div>}
              </>
            )}
          </>
        ) : (
          <>
            <div className={styles.branchInputRow} ref={pickerRef}>
              <input
                className={styles.input}
                value={selectedBranch}
                onChange={(e) => { setSelectedBranch(e.target.value); setPrError('') }}
                disabled={loading || isCreating || prResolving}
                placeholder="Branch name, PR URL, or #123 (press Enter to resolve)"
              />
              {prResolving && <span className={styles.prSpinner} />}
              <button
                className={styles.pickerBtn}
                onClick={() => setPickerOpen((v) => !v)}
                disabled={loading || isCreating || prResolving}
                type="button"
              >
                &#9662;
              </button>
              {pickerOpen && (
                <div className={styles.pickerDropdown}>
                  {branches.map((b) => (
                    <div
                      key={b}
                      className={`${styles.pickerOption} ${b === selectedBranch ? styles.pickerOptionActive : ''}`}
                      onClick={() => { setSelectedBranch(b); setPickerOpen(false); setPrError('') }}
                    >
                      {b}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {prError && <div className={styles.prError}>{prError}</div>}
          </>
        )}

        {isCreating && (
          <div className={styles.createStatus} role="status" aria-live="polite">
            <span className={styles.createSpinner} />
            <span>{createProgressMessage || 'Creating workspace...'}</span>
          </div>
        )}
        {isCreating && showSlowCreateMessage && (
          <div className={styles.createSlowNote}>
            Taking longer than usual. Git network sync may be slow.
          </div>
        )}

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={animateExit} disabled={isCreating || exiting}>Cancel</button>
          <button className={styles.createBtn} onClick={handleSubmit} disabled={createDisabled}>
            {isCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
