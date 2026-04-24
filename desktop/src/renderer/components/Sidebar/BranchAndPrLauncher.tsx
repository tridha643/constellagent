import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { GitBranch } from 'lucide-react'
import { useAppStore } from '../../store/app-store'
import { Tooltip } from '../Tooltip/Tooltip'
import { normalizeWorkspaceBranch } from '../../store/workspace-branch'
import styles from './Sidebar.module.css'

const POPOVER_WIDTH = 320
const POPOVER_GAP = 6
const POPOVER_EDGE_MARGIN = 12

interface Props {
  projectId: string
  repoPath: string
  workspaceId: string
  worktreePath: string
  workspaceBranch: string
}

function slugifyBranch(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function defaultBranchNameFromMessage(message: string): string {
  const firstLine = message.split('\n')[0] ?? ''
  const slug = slugifyBranch(firstLine)
  if (slug) return slug
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)
  return `quick-pr-${stamp}`
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim()
  return fallback
}

/**
 * Sidebar affordance for "I have changes on main — branch them, commit, PR, and
 * get me back to main" in one click. Only renders when the workspace is on the
 * project's resolved default branch and has uncommitted or staged changes.
 */
export function BranchAndPrLauncher({
  projectId,
  repoPath,
  workspaceId,
  worktreePath,
  workspaceBranch,
}: Props) {
  const defaultBranchByProjectId = useAppStore((s) => s.defaultBranchByProjectId)
  const gitFileStatuses = useAppStore((s) => s.gitFileStatuses)
  const setProjectDefaultBranch = useAppStore((s) => s.setProjectDefaultBranch)
  const updateWorkspaceBranch = useAppStore((s) => s.updateWorkspaceBranch)
  const addToast = useAppStore((s) => s.addToast)

  const defaultBranch = defaultBranchByProjectId.get(projectId) ?? ''

  // Lazy-load the project's default branch once. Dedupes across all launchers
  // mounted for the same project via the store cache check.
  const fetchedRef = useRef(false)
  useEffect(() => {
    if (defaultBranch || fetchedRef.current) return
    fetchedRef.current = true
    let cancelled = false
    window.api.git.getDefaultBranch(repoPath)
      .then((resolved) => {
        if (cancelled) return
        const normalized = normalizeWorkspaceBranch(resolved)
        if (normalized) setProjectDefaultBranch(projectId, normalized)
      })
      .catch(() => {
        // Best-effort: the Changes panel also loads this and will fill the store.
      })
    return () => { cancelled = true }
  }, [defaultBranch, projectId, repoPath, setProjectDefaultBranch])

  const normalizedWorkspaceBranch = normalizeWorkspaceBranch(workspaceBranch)
  const onDefaultBranch = !!defaultBranch && normalizedWorkspaceBranch === defaultBranch
  const dirtyFileCount = gitFileStatuses.get(worktreePath)?.size ?? 0
  const hasDirtyChanges = dirtyFileCount > 0
  const visible = onDefaultBranch && hasDirtyChanges

  const [open, setOpen] = useState(false)
  const [branchName, setBranchName] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [generatingMessage, setGeneratingMessage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const branchInputRef = useRef<HTMLInputElement | null>(null)

  // Position the popover via fixed coords anchored under the trigger so it can
  // overflow the sidebar's clipped x-axis (.projectList uses overflow-x: hidden).
  // Keeps the popover on-screen: prefers right-alignment with the button, flips
  // below/above, and clamps inside the viewport.
  const computePosition = useCallback(() => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    const width = Math.min(POPOVER_WIDTH, viewportW - POPOVER_EDGE_MARGIN * 2)
    let left = rect.right - width
    if (left < POPOVER_EDGE_MARGIN) left = POPOVER_EDGE_MARGIN
    if (left + width > viewportW - POPOVER_EDGE_MARGIN) {
      left = Math.max(POPOVER_EDGE_MARGIN, viewportW - width - POPOVER_EDGE_MARGIN)
    }

    const belowTop = rect.bottom + POPOVER_GAP
    const popoverEl = popoverRef.current
    const measuredHeight = popoverEl?.offsetHeight ?? 260
    const spaceBelow = viewportH - belowTop - POPOVER_EDGE_MARGIN
    const flipAbove = spaceBelow < measuredHeight && rect.top > measuredHeight + POPOVER_EDGE_MARGIN
    const top = flipAbove
      ? Math.max(POPOVER_EDGE_MARGIN, rect.top - POPOVER_GAP - measuredHeight)
      : belowTop

    setPopoverStyle({
      position: 'fixed',
      top,
      left,
      width,
    })
  }, [])

  const closePopover = useCallback(() => {
    if (busy) return
    setOpen(false)
    setPopoverStyle(null)
  }, [busy])

  // Measure + reposition on open, and whenever the window geometry shifts.
  useLayoutEffect(() => {
    if (!open) return
    computePosition()
    // Second pass after the popover has actually rendered so we can use its
    // measured height for the above/below flip decision.
    const raf = requestAnimationFrame(computePosition)
    return () => cancelAnimationFrame(raf)
  }, [open, computePosition])

  useEffect(() => {
    if (!open) return
    const onReflow = () => computePosition()
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true)
    return () => {
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow, true)
    }
  }, [open, computePosition])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closePopover()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, closePopover])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (popoverRef.current?.contains(target)) return
      if (buttonRef.current?.contains(target)) return
      closePopover()
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [open, closePopover])

  // Reset editor state whenever the popover (re)opens; pre-fill via Pi on open.
  useEffect(() => {
    if (!open) return
    setCommitMessage('')
    setBranchName('')
    setGeneratingMessage(true)

    let cancelled = false
    window.api.app.generateCommitMessage(worktreePath)
      .then((msg) => {
        if (cancelled) return
        const trimmed = msg.trim()
        setCommitMessage(trimmed)
        setBranchName(defaultBranchNameFromMessage(trimmed))
        requestAnimationFrame(() => branchInputRef.current?.select())
      })
      .catch(() => {
        if (cancelled) return
        setBranchName(defaultBranchNameFromMessage(''))
        requestAnimationFrame(() => branchInputRef.current?.select())
      })
      .finally(() => {
        if (!cancelled) setGeneratingMessage(false)
      })

    return () => { cancelled = true }
  }, [open, worktreePath])

  const canSubmit = useMemo(() => {
    return (
      !busy
      && !!defaultBranch
      && branchName.trim().length > 0
      && commitMessage.trim().length > 0
      && branchName.trim() !== defaultBranch
    )
  }, [busy, defaultBranch, branchName, commitMessage])

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    const trimmedBranch = branchName.trim()
    const trimmedMessage = commitMessage.trim()
    const trunk = defaultBranch.trim()

    setBusy(true)
    setBusyLabel('Creating branch…')
    let branchCreated = false
    let branchCommitted = false

    try {
      await window.api.git.checkoutBranch(worktreePath, trimmedBranch, true)
      branchCreated = true
      updateWorkspaceBranch(workspaceId, trimmedBranch)

      setBusyLabel('Committing…')
      await window.api.git.stageAll(worktreePath)
      await window.api.git.commit(worktreePath, trimmedMessage)
      branchCommitted = true
      window.dispatchEvent(new CustomEvent('git:files-changed', {
        detail: { worktreePath },
      }))

      setBusyLabel('Pushing…')
      await window.api.git.pushCurrentBranch(worktreePath)

      setBusyLabel('Creating PR…')
      const created = await window.api.github.createPr(worktreePath, trimmedBranch, trunk)

      setBusyLabel(`Back to ${trunk}…`)
      await window.api.git.checkoutBranch(worktreePath, trunk, false)
      updateWorkspaceBranch(workspaceId, trunk)
      window.dispatchEvent(new CustomEvent('git:files-changed', {
        detail: { worktreePath },
      }))

      addToast({
        id: crypto.randomUUID(),
        message: `PR #${created.number} opened`,
        type: 'info',
      })
      if (created.url) window.open(created.url, '_blank')

      setOpen(false)
    } catch (err) {
      const recoveryHint = branchCreated && !branchCommitted
        ? ` Your changes are now on "${trimmedBranch}" — finish or roll back there.`
        : ''
      console.error('[BranchAndPrLauncher] failed:', err)
      addToast({
        id: crypto.randomUUID(),
        message: errorMessage(err, 'Failed to branch & PR') + recoveryHint,
        type: 'error',
      })
    } finally {
      setBusy(false)
      setBusyLabel('')
    }
  }, [addToast, branchName, canSubmit, commitMessage, defaultBranch, updateWorkspaceBranch, workspaceId, worktreePath])

  const handleFormKey = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void handleSubmit()
    }
  }, [handleSubmit])

  if (!visible) return null

  const trunkLabel = defaultBranch || 'main'
  const branchInvalid = branchName.trim() === defaultBranch && branchName.trim().length > 0

  const popoverContent = open && popoverStyle ? (
    <div
      ref={popoverRef}
      className={styles.branchPrPopover}
      style={popoverStyle}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={handleFormKey}
      role="dialog"
      aria-label="Branch changes and open pull request"
    >
      <div className={styles.branchPrPopoverTitle}>
        Move {dirtyFileCount} change{dirtyFileCount === 1 ? '' : 's'} off {trunkLabel}
      </div>
      <label className={styles.branchPrLabel}>
        <span>New branch</span>
        <input
          ref={branchInputRef}
          className={styles.branchPrInput}
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
          placeholder="feature-name"
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      {branchInvalid && (
        <div className={styles.branchPrHint}>
          Pick a name different from "{defaultBranch}".
        </div>
      )}
      <label className={styles.branchPrLabel}>
        <span>Commit message{generatingMessage ? ' (generating…)' : ''}</span>
        <textarea
          className={styles.branchPrTextarea}
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Describe this change"
          rows={3}
          disabled={busy}
        />
      </label>
      <div className={styles.branchPrActions}>
        <button
          type="button"
          className={styles.branchPrSecondary}
          onClick={closePopover}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.branchPrPrimary}
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          title="⌘⏎ / Ctrl+⏎"
        >
          {busy ? busyLabel || 'Working…' : `Create PR to ${trunkLabel}`}
        </button>
      </div>
    </div>
  ) : null

  return (
    <>
      <Tooltip label={`Branch, commit & PR (currently on ${trunkLabel})`}>
        <button
          ref={buttonRef}
          className={styles.branchPrBtn}
          onClick={(e: MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation()
            setOpen((prev) => !prev)
          }}
          aria-label="Branch changes and open pull request"
          type="button"
        >
          <GitBranch size={12} strokeWidth={2} />
        </button>
      </Tooltip>
      {popoverContent && createPortal(popoverContent, document.body)}
    </>
  )
}
