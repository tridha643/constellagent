import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '../../store/app-store'
import styles from './Sidebar.module.css'

interface GraphiteStackProps {
  workspaceId: string
  worktreePath: string
  repoPath: string
  /** When set, overrides git default as the expected stack trunk. */
  graphitePreferredTrunk?: string | null
}

const COLLAPSED_PILL_COUNT = 3

function normalizeBranchName(branch: string): string {
  return branch.trim().replace(/^refs\/heads\//, '').replace(/^origin\//, '')
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim()
  return fallback
}

export function GraphiteStack({
  workspaceId,
  worktreePath,
  repoPath,
  graphitePreferredTrunk,
}: GraphiteStackProps) {
  const stack = useAppStore((s) => s.graphiteStacks.get(workspaceId))
  const expanded = useAppStore((s) => s.graphiteStackExpanded)
  const toggleExpanded = useAppStore((s) => s.toggleGraphiteStackExpanded)
  const updateWorkspaceBranch = useAppStore((s) => s.updateWorkspaceBranch)
  const addToast = useAppStore((s) => s.addToast)
  const [checking, setChecking] = useState<string | null>(null)
  const checkoutBusyRef = useRef(false)
  const [effectiveTrunk, setEffectiveTrunk] = useState<string | null>(null)
  const [trunkResolved, setTrunkResolved] = useState(false)

  useEffect(() => {
    let cancelled = false
    const preferred = normalizeBranchName(graphitePreferredTrunk?.trim() ?? '')
    if (preferred) {
      setEffectiveTrunk(preferred)
      setTrunkResolved(true)
      return
    }

    setTrunkResolved(false)
    window.api.git.getDefaultBranch(repoPath)
      .then((resolved) => {
        if (cancelled) return
        setEffectiveTrunk(normalizeBranchName(resolved))
        setTrunkResolved(true)
      })
      .catch(() => {
        if (cancelled) return
        setEffectiveTrunk(null)
        setTrunkResolved(true)
      })

    return () => { cancelled = true }
  }, [repoPath, graphitePreferredTrunk])

  const handleCheckout = useCallback(async (branchName: string) => {
    const currentStack = useAppStore.getState().graphiteStacks.get(workspaceId)
    if (!currentStack || branchName === currentStack.currentBranch) return
    if (checkoutBusyRef.current) return
    checkoutBusyRef.current = true
    setChecking(branchName)
    try {
      const statuses = await window.api.git.getStatus(worktreePath)
      if (statuses.length > 0) {
        addToast({
          id: crypto.randomUUID(),
          message:
            'Can’t switch stack branches while you have local changes. Stage or discard them in Changes, then try again.',
          type: 'warning',
        })
        return
      }

      await window.api.graphite.checkoutBranch(worktreePath, branchName)
      updateWorkspaceBranch(workspaceId, branchName)
      const after = useAppStore.getState().graphiteStacks.get(workspaceId)
      if (after) {
        useAppStore.getState().setGraphiteStack(workspaceId, {
          ...after,
          currentBranch: branchName,
        })
      }
    } catch (err) {
      addToast({
        id: crypto.randomUUID(),
        message: errorMessage(err, 'Failed to switch branch'),
        type: 'error',
      })
    } finally {
      checkoutBusyRef.current = false
      setChecking(null)
    }
  }, [addToast, updateWorkspaceBranch, worktreePath, workspaceId])

  const stackTrunk = stack?.branches[0]?.name
    ? normalizeBranchName(stack.branches[0].name)
    : ''
  const trunkMatches =
    !!effectiveTrunk && !!stackTrunk && stackTrunk === effectiveTrunk

  if (!trunkResolved || !trunkMatches) return null
  if (!stack || stack.branches.length <= 1) return null

  const pills = [...stack.branches].reverse()
  const canCollapse = pills.length > COLLAPSED_PILL_COUNT

  return (
    <div
      className={`${styles.graphiteStack} ${canCollapse && !expanded ? styles.graphiteStackCollapsed : ''}`}
    >
      {pills.map((b) => {
        const isCurrent = b.name === stack.currentBranch
        const isChecking = checking === b.name
        return (
          <button
            key={b.name}
            type="button"
            className={`${styles.graphiteBranch} ${isCurrent ? styles.graphiteBranchCurrent : ''} ${isChecking ? styles.graphiteBranchChecking : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              void handleCheckout(b.name)
            }}
            disabled={isCurrent || checking !== null}
            title={isCurrent ? `Current branch: ${b.name}` : `Switch to ${b.name}`}
          >
            <span className={styles.graphiteBranchName}>{b.name}</span>
          </button>
        )
      })}
      {canCollapse && (
        <button
          type="button"
          className={styles.graphiteStackToggle}
          onClick={(e) => {
            e.stopPropagation()
            toggleExpanded()
          }}
          title={expanded ? 'Collapse stack (⇧⌘T)' : `Show all ${pills.length} branches (⇧⌘T)`}
        >
          {expanded ? '▴ less' : `▾ ${pills.length - COLLAPSED_PILL_COUNT} more`}
        </button>
      )}
    </div>
  )
}
