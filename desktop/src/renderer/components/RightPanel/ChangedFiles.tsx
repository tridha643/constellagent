import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '../../store/app-store'
import { STATUS_LABELS } from '../../../shared/status-labels'
import { useFileWatcher } from '../../hooks/useFileWatcher'
import { Tooltip } from '../Tooltip/Tooltip'
import { PiIcon } from '../Icons/PiIcon'
import type { GraphiteStackAction } from '../../../shared/graphite-types'
import styles from './RightPanel.module.css'

const PR_POLL_HINT_EVENT = 'constellagent:pr-poll-hint'

interface FileStatus {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  staged: boolean
}

interface Props {
  worktreePath: string
  workspaceId: string
  isActive?: boolean
}

interface GraphiteActionOption {
  action: GraphiteStackAction
  label: string
  hint: string
  enabled: boolean
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim()
  return fallback
}

function graphiteProgressLabel(action: GraphiteStackAction): string {
  if (action === 'start-stack') return 'Starting stack…'
  if (action === 'add-to-stack') return 'Adding to stack…'
  return 'Submitting stack…'
}

export function ChangedFiles({ worktreePath, workspaceId, isActive }: Props) {
  const [files, setFiles] = useState<FileStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [busyAction, setBusyAction] = useState<'commit' | 'pr' | 'graphite' | 'generate-commit-message' | null>(null)
  const [busyLabel, setBusyLabel] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [currentBranch, setCurrentBranch] = useState('')
  const [defaultBranch, setDefaultBranch] = useState('')
  const [defaultBranchLoading, setDefaultBranchLoading] = useState(true)
  const [graphiteMenuOpen, setGraphiteMenuOpen] = useState(false)
  const [selectedGraphiteAction, setSelectedGraphiteAction] = useState<GraphiteStackAction | null>(null)
  const graphiteMenuRef = useRef<HTMLDivElement | null>(null)
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null)
  const openDiffTab = useAppStore((s) => s.openDiffTab)
  const setGitFileStatuses = useAppStore((s) => s.setGitFileStatuses)
  const addToast = useAppStore((s) => s.addToast)
  const workspaces = useAppStore((s) => s.workspaces)
  const projects = useAppStore((s) => s.projects)
  const prStatusMap = useAppStore((s) => s.prStatusMap)
  const setPrStatuses = useAppStore((s) => s.setPrStatuses)
  const setGhAvailability = useAppStore((s) => s.setGhAvailability)
  const updateWorkspaceBranch = useAppStore((s) => s.updateWorkspaceBranch)
  const setGraphiteStack = useAppStore((s) => s.setGraphiteStack)

  const workspace = workspaces.find((ws) => ws.id === workspaceId)
  const project = workspace ? projects.find((p) => p.id === workspace.projectId) : undefined
  const branch = (currentBranch || workspace?.branch || '').trim()
  const prInfo = project && branch ? prStatusMap.get(`${project.id}:${branch}`) ?? null : null

  const refresh = useCallback(async () => {
    try {
      const statuses = await window.api.git.getStatus(worktreePath)
      setFiles(statuses)
    } catch {
      // Best effort — empty state already communicates enough.
    }
  }, [worktreePath])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api.git.getStatus(worktreePath).then((statuses) => {
      if (!cancelled) {
        setFiles(statuses)
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [worktreePath])

  useEffect(() => {
    let cancelled = false
    if (!workspace) {
      setCurrentBranch('')
      return
    }

    window.api.git.getCurrentBranch(worktreePath).then((actual) => {
      if (cancelled) return
      const normalized = actual.trim()
      if (normalized) {
        setCurrentBranch(normalized)
        if (normalized !== workspace.branch) updateWorkspaceBranch(workspace.id, normalized)
      } else {
        setCurrentBranch(workspace.branch)
      }
    }).catch(() => {
      if (!cancelled) setCurrentBranch(workspace.branch)
    })

    return () => { cancelled = true }
  }, [workspace, worktreePath, updateWorkspaceBranch])

  useEffect(() => {
    let cancelled = false
    if (!project) {
      setDefaultBranch('')
      setDefaultBranchLoading(false)
      return
    }

    setDefaultBranchLoading(true)
    window.api.git.getDefaultBranch(project.repoPath)
      .then((resolved) => {
        if (cancelled) return
        setDefaultBranch(resolved.replace(/^origin\//, '').trim())
        setDefaultBranchLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setDefaultBranch('')
        setDefaultBranchLoading(false)
      })

    return () => { cancelled = true }
  }, [project])

  const refreshPrStatus = useCallback(async (targetBranch?: string) => {
    const effectiveBranch = (targetBranch ?? branch).trim()
    if (!project || !effectiveBranch) return
    try {
      const result = await window.api.github.getPrStatuses(project.repoPath, [effectiveBranch])
      setGhAvailability(project.id, result.available)
      if (result.available) {
        setPrStatuses(project.id, result.data)
      }
    } catch {
      // PR status is best-effort here; the global poller will keep things fresh.
    }
  }, [branch, project, setGhAvailability, setPrStatuses])

  useEffect(() => {
    if (!isActive || !project || !branch) return
    void refreshPrStatus()
  }, [isActive, project, branch, refreshPrStatus])

  useEffect(() => {
    if (!graphiteMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!graphiteMenuRef.current?.contains(event.target as Node)) {
        setGraphiteMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGraphiteMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [graphiteMenuOpen])

  // Watch filesystem for changes and auto-refresh
  useFileWatcher(worktreePath, refresh)

  // Explicit refresh after checkpoint restore / git ops that bypass FS watcher timing
  useEffect(() => {
    const onGitFilesChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ worktreePath?: string }>).detail
      if (detail?.worktreePath === worktreePath) void refresh()
    }
    window.addEventListener('git:files-changed', onGitFilesChanged)
    return () => window.removeEventListener('git:files-changed', onGitFilesChanged)
  }, [worktreePath, refresh])

  // Re-fetch when tab becomes visible (git ops only touch .git/ which the watcher ignores)
  useEffect(() => {
    if (isActive) void refresh()
  }, [isActive, refresh])

  // Push git file statuses to Zustand store for tab badges
  useEffect(() => {
    const statusMap = new Map<string, string>()
    for (const f of files) {
      statusMap.set(f.path, f.status)
    }
    setGitFileStatuses(worktreePath, statusMap)
  }, [files, worktreePath, setGitFileStatuses])

  const staged = files.filter((f) => f.staged)
  const unstaged = files.filter((f) => !f.staged)
  const commitMessage = commitMsg.trim()
  const hasOpenPr = prInfo?.state === 'open'
  const hasClosedPr = prInfo?.state === 'closed'
  const hasMergedPr = prInfo?.state === 'merged'
  const isRenderableBranch = !!branch && branch.toUpperCase() !== 'HEAD'
  const isDefaultBranch = !!defaultBranch && branch === defaultBranch
  const canShowPrAction = !!project && !!defaultBranch && isRenderableBranch && !defaultBranchLoading && !isDefaultBranch && !hasOpenPr && !hasMergedPr
  const prActionMode: 'create' | 'reopen' | null = canShowPrAction
    ? (hasClosedPr ? 'reopen' : 'create')
    : null
  const needsCommitForPr = staged.length > 0
  const prActionDisabled = busy || (needsCommitForPr && commitMessage.length === 0)
  const prActionLabel = prActionMode === 'reopen'
    ? (needsCommitForPr ? 'Commit + Reopen PR' : 'Reopen PR')
    : (needsCommitForPr ? 'Commit + Create PR' : 'Create PR')
  const prTooltipLabel = prActionMode === 'reopen'
    ? 'Reopen this pull request and open it in your browser'
    : needsCommitForPr
      ? 'Commit staged changes, push the branch, and create a pull request'
      : 'Push the branch and create a pull request'

  const graphiteVisible = !!project && !!defaultBranch && isRenderableBranch && !defaultBranchLoading && (staged.length > 0 || !isDefaultBranch)
  const allowedGraphiteActions: GraphiteStackAction[] = !graphiteVisible
    ? []
    : isDefaultBranch
      ? ['start-stack']
      : ['add-to-stack', 'submit-stack']
  const graphiteOptions: GraphiteActionOption[] = [
    {
      action: 'start-stack',
      label: 'Start Stack',
      hint: 'Create the first stacked branch from your staged changes',
      enabled: graphiteVisible && isDefaultBranch && staged.length > 0 && commitMessage.length > 0,
    },
    {
      action: 'add-to-stack',
      label: 'Add to Stack',
      hint: 'Create the next stacked branch on top of the current branch',
      enabled: graphiteVisible && !isDefaultBranch && staged.length > 0 && commitMessage.length > 0,
    },
    {
      action: 'submit-stack',
      label: 'Submit Stack',
      hint: 'Open or update draft PRs for the current Graphite stack',
      enabled: graphiteVisible && !isDefaultBranch,
    },
  ]
  const graphiteRecommended: GraphiteStackAction | null = !graphiteVisible
    ? null
    : isDefaultBranch
      ? 'start-stack'
      : staged.length > 0
        ? 'add-to-stack'
        : 'submit-stack'
  const graphiteSelection = graphiteOptions.find((option) => option.action === selectedGraphiteAction)
  const graphitePrimary = graphiteSelection
    ?? graphiteOptions.find((option) => option.action === graphiteRecommended)
    ?? null
  const showControls = !!prActionMode || graphiteVisible || files.length > 0

  useEffect(() => {
    if (!graphiteVisible) {
      setSelectedGraphiteAction(null)
      setGraphiteMenuOpen(false)
      return
    }

    if (!selectedGraphiteAction || !allowedGraphiteActions.includes(selectedGraphiteAction)) {
      setSelectedGraphiteAction(graphiteRecommended ?? allowedGraphiteActions[0] ?? null)
    }
  }, [allowedGraphiteActions, graphiteRecommended, graphiteVisible, selectedGraphiteAction])

  const runGitOp = useCallback(async (
    op: () => Promise<void>,
    fallback: string,
  ) => {
    setBusy(true)
    setBusyAction(null)
    setBusyLabel('')
    try {
      await op()
    } catch (err) {
      console.error('[ChangedFiles] git operation failed:', err)
      addToast({
        id: crypto.randomUUID(),
        message: errorMessage(err, fallback),
        type: 'error',
      })
    } finally {
      await refresh()
      setBusy(false)
      setBusyAction(null)
      setBusyLabel('')
    }
  }, [addToast, refresh])

  const stageFiles = useCallback((paths: string[]) => {
    void runGitOp(() => window.api.git.stage(worktreePath, paths), 'Failed to stage changes')
  }, [worktreePath, runGitOp])

  const unstageFiles = useCallback((paths: string[]) => {
    void runGitOp(() => window.api.git.unstage(worktreePath, paths), 'Failed to unstage changes')
  }, [worktreePath, runGitOp])

  const discardFiles = useCallback((file: FileStatus) => {
    const op = file.status === 'untracked'
      ? () => window.api.git.discard(worktreePath, [], [file.path])
      : () => window.api.git.discard(worktreePath, [file.path], [])
    void runGitOp(async () => {
      await op()
      window.dispatchEvent(new CustomEvent('git:files-changed', {
        detail: { worktreePath, paths: [file.path] },
      }))
    }, `Failed to discard ${file.path}`)
  }, [worktreePath, runGitOp])

  const handleGenerateCommitMessage = useCallback(async () => {
    if (files.length === 0) return

    setBusy(true)
    setBusyAction('generate-commit-message')
    setBusyLabel('Generating…')

    try {
      const message = await window.api.app.generateCommitMessage(worktreePath)
      setCommitMsg(message)
      addToast({
        id: crypto.randomUUID(),
        message: 'Commit message generated',
        type: 'info',
      })
      requestAnimationFrame(() => commitInputRef.current?.focus())
    } catch (err) {
      console.error('[ChangedFiles] commit message generation failed:', err)
      addToast({
        id: crypto.randomUUID(),
        message: errorMessage(err, 'Failed to generate commit message'),
        type: 'error',
      })
    } finally {
      setBusy(false)
      setBusyAction(null)
      setBusyLabel('')
    }
  }, [addToast, files.length, worktreePath])

  const handleCommit = useCallback(async () => {
    if (!commitMessage || staged.length === 0) return
    const committedPaths = staged.map((f) => f.path)
    setBusy(true)
    setBusyAction('commit')
    setBusyLabel('Committing…')
    try {
      await window.api.git.commit(worktreePath, commitMessage)
      setCommitMsg('')
      window.dispatchEvent(new CustomEvent('git:files-changed', {
        detail: { worktreePath, paths: committedPaths },
      }))
    } catch (err) {
      console.error('[ChangedFiles] commit failed:', err)
      addToast({
        id: crypto.randomUUID(),
        message: errorMessage(err, 'Failed to commit staged changes'),
        type: 'error',
      })
    } finally {
      await refresh()
      setBusy(false)
      setBusyAction(null)
      setBusyLabel('')
    }
  }, [addToast, commitMessage, refresh, staged, worktreePath])

  const handlePrAction = useCallback(async () => {
    if (!project || !prActionMode) return
    if (needsCommitForPr && !commitMessage) return

    const committedPaths = staged.map((f) => f.path)
    const baseBranch = defaultBranch.trim()
    const targetPrNumber = prInfo?.number

    setBusy(true)
    setBusyAction('pr')
    setBusyLabel(needsCommitForPr ? 'Committing…' : (prActionMode === 'reopen' ? 'Reopening PR…' : 'Creating PR…'))

    try {
      if (needsCommitForPr) {
        await window.api.git.commit(worktreePath, commitMessage)
        setCommitMsg('')
        if (committedPaths.length > 0) {
          window.dispatchEvent(new CustomEvent('git:files-changed', {
            detail: { worktreePath, paths: committedPaths },
          }))
        }
      }

      let prUrl = prInfo?.url ?? ''

      if (prActionMode === 'create') {
        setBusyLabel('Pushing…')
        await window.api.git.pushCurrentBranch(worktreePath)
        setBusyLabel('Creating PR…')
        const created = await window.api.github.createPr(worktreePath, branch, baseBranch)
        prUrl = created.url
      } else {
        if (!targetPrNumber) throw new Error('No closed pull request found for this branch.')
        setBusyLabel('Reopening PR…')
        const reopened = await window.api.github.reopenPr(worktreePath, targetPrNumber)
        prUrl = reopened.url
      }

      await refreshPrStatus()
      window.dispatchEvent(new CustomEvent(PR_POLL_HINT_EVENT, {
        detail: { worktreePath, branch, kind: 'pr' },
      }))

      if (prUrl) {
        window.open(prUrl, '_blank')
      }
    } catch (err) {
      console.error('[ChangedFiles] PR action failed:', err)
      addToast({
        id: crypto.randomUUID(),
        message: errorMessage(
          err,
          prActionMode === 'reopen' ? 'Failed to reopen pull request' : 'Failed to create pull request',
        ),
        type: 'error',
      })
    } finally {
      await refresh()
      setBusy(false)
      setBusyAction(null)
      setBusyLabel('')
    }
  }, [
    addToast,
    branch,
    commitMessage,
    defaultBranch,
    needsCommitForPr,
    prActionMode,
    prInfo,
    project,
    refresh,
    refreshPrStatus,
    staged,
    worktreePath,
  ])

  const handleGraphiteAction = useCallback(async (action: GraphiteStackAction | null) => {
    if (!project || !defaultBranch || !action) return
    const selected = graphiteOptions.find((option) => option.action === action)
    if (!selected?.enabled) return

    setGraphiteMenuOpen(false)
    setBusy(true)
    setBusyAction('graphite')
    setBusyLabel(graphiteProgressLabel(action))

    try {
      const result = await window.api.graphite.runStackAction(
        project.repoPath,
        worktreePath,
        action,
        commitMessage,
        defaultBranch,
      )

      if (result.branch) {
        setCurrentBranch(result.branch)
        updateWorkspaceBranch(workspaceId, result.branch)
        await refreshPrStatus(result.branch)
        window.dispatchEvent(new CustomEvent(PR_POLL_HINT_EVENT, {
          detail: { worktreePath, branch: result.branch, kind: 'pr' },
        }))
      }

      try {
        const stack = await window.api.graphite.getStack(project.repoPath, worktreePath)
        setGraphiteStack(workspaceId, stack)
      } catch {
        // Best effort — poller will catch up.
      }

      if (action !== 'submit-stack') {
        setCommitMsg('')
      }
    } catch (err) {
      console.error('[ChangedFiles] Graphite action failed:', err)
      addToast({
        id: crypto.randomUUID(),
        message: errorMessage(err, 'Graphite stack action failed'),
        type: 'error',
      })
    } finally {
      await refresh()
      setBusy(false)
      setBusyAction(null)
      setBusyLabel('')
    }
  }, [
    addToast,
    commitMessage,
    defaultBranch,
    graphiteOptions,
    project,
    refresh,
    refreshPrStatus,
    setGraphiteStack,
    updateWorkspaceBranch,
    workspaceId,
    worktreePath,
  ])

  const openDiff = useCallback((path: string) => {
    openDiffTab(workspaceId)
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('diff:scrollToFile', { detail: path }))
    })
  }, [openDiffTab, workspaceId])

  if (loading) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyText}>Checking changes...</span>
      </div>
    )
  }

  if (files.length === 0 && !showControls) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon}>✓</span>
        <span className={styles.emptyText}>No changes</span>
      </div>
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleCommit()
    }
  }

  return (
    <div className={styles.changedFilesList}>
      {showControls && (
        <div className={styles.commitArea}>
          <div className={styles.commitInputRow}>
            <textarea
              ref={commitInputRef}
              className={styles.commitInput}
              placeholder="Commit message"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <Tooltip label={busy && busyAction === 'generate-commit-message' ? 'Generating commit message…' : 'Generate commit message with PI'}>
              <button
                type="button"
                className={styles.commitPiButton}
                disabled={busy || files.length === 0}
                onClick={() => { void handleGenerateCommitMessage() }}
                aria-label="Generate commit message with PI"
              >
                <PiIcon className={`${styles.commitPiIcon} ${busy && busyAction === 'generate-commit-message' ? styles.commitPiIconBusy : ''}`} />
              </button>
            </Tooltip>
          </div>
          <div className={styles.commitActions}>
            <Tooltip label="Commit staged changes" shortcut="⌘↵">
              <button
                className={`${styles.commitButton} ${(prActionMode || graphiteVisible) ? styles.commitButtonSecondary : ''}`}
                disabled={busy || !commitMessage || staged.length === 0}
                onClick={() => { void handleCommit() }}
              >
                {busy && busyAction === 'commit' && busyLabel ? busyLabel : 'Commit'}
              </button>
            </Tooltip>
            {prActionMode && (
              <Tooltip label={prTooltipLabel}>
                <button
                  className={`${styles.commitButton} ${styles.prActionButton}`}
                  disabled={prActionDisabled}
                  onClick={() => { void handlePrAction() }}
                >
                  {busy && busyAction === 'pr' && busyLabel ? busyLabel : prActionLabel}
                </button>
              </Tooltip>
            )}
            {graphiteVisible && graphitePrimary && (
              <div className={styles.graphiteSplitWrap} ref={graphiteMenuRef}>
                <div className={styles.graphiteSplitGroup}>
                  <Tooltip label={graphitePrimary.hint}>
                    <button
                      className={`${styles.commitButton} ${styles.prActionButton} ${styles.graphiteMainButton}`}
                      disabled={!graphitePrimary.enabled || busy}
                      onClick={() => { void handleGraphiteAction(graphitePrimary.action) }}
                    >
                      {busy && busyAction === 'graphite' && busyLabel ? busyLabel : graphitePrimary.label}
                    </button>
                  </Tooltip>
                  <Tooltip label="Choose a Graphite stack action">
                    <button
                      className={`${styles.commitButton} ${styles.prActionButton} ${styles.graphiteMenuButton}`}
                      data-open={graphiteMenuOpen}
                      disabled={busy}
                      onClick={() => setGraphiteMenuOpen((open) => !open)}
                      aria-haspopup="menu"
                      aria-expanded={graphiteMenuOpen}
                    >
                      ▾
                    </button>
                  </Tooltip>
                </div>
                {graphiteMenuOpen && (
                  <div className={styles.graphiteMenu} role="menu">
                    {graphiteOptions.map((option) => (
                      <button
                        key={option.action}
                        className={`${styles.graphiteMenuItem} ${selectedGraphiteAction === option.action ? styles.graphiteMenuItemActive : ''}`}
                        disabled={!option.enabled || busy}
                        onClick={() => {
                          setSelectedGraphiteAction(option.action)
                          setGraphiteMenuOpen(false)
                        }}
                        role="menuitemradio"
                        aria-checked={selectedGraphiteAction === option.action}
                      >
                        <span className={styles.graphiteMenuTitle}>{option.label}</span>
                        <span className={styles.graphiteMenuHint}>{option.hint}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {staged.length > 0 && (
        <div className={styles.changeSection}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>Staged Changes</span>
            <span className={styles.sectionCount}>{staged.length}</span>
            <span className={styles.sectionActions}>
              <Tooltip label="Unstage All">
                <button
                  className={styles.sectionAction}
                  disabled={busy}
                  onClick={() => unstageFiles(staged.map((f) => f.path))}
                >
                  −
                </button>
              </Tooltip>
            </span>
          </div>
          {staged.map((file) => (
            <FileRow
              key={`staged-${file.path}`}
              file={file}
              busy={busy}
              onAction={() => unstageFiles([file.path])}
              actionLabel="−"
              actionTitle="Unstage"
              onOpenDiff={openDiff}
            />
          ))}
        </div>
      )}

      {unstaged.length > 0 && (
        <div className={styles.changeSection}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>Changes</span>
            <span className={styles.sectionCount}>{unstaged.length}</span>
            <span className={styles.sectionActions}>
              <Tooltip label="Discard All">
                <button
                  className={styles.sectionAction}
                  disabled={busy}
                  onClick={() => {
                    const tracked = unstaged.filter((f) => f.status !== 'untracked').map((f) => f.path)
                    const untracked = unstaged.filter((f) => f.status === 'untracked').map((f) => f.path)
                    const allPaths = unstaged.map((f) => f.path)
                    void runGitOp(async () => {
                      await window.api.git.discard(worktreePath, tracked, untracked)
                      window.dispatchEvent(new CustomEvent('git:files-changed', {
                        detail: { worktreePath, paths: allPaths },
                      }))
                    }, 'Failed to discard changes')
                  }}
                >
                  ↩
                </button>
              </Tooltip>
              <Tooltip label="Stage All">
                <button
                  className={styles.sectionAction}
                  disabled={busy}
                  onClick={() => stageFiles(unstaged.map((f) => f.path))}
                >
                  +
                </button>
              </Tooltip>
            </span>
          </div>
          {unstaged.map((file) => (
            <FileRow
              key={`unstaged-${file.path}`}
              file={file}
              busy={busy}
              onAction={() => stageFiles([file.path])}
              actionLabel="+"
              actionTitle="Stage"
              onDiscard={() => discardFiles(file)}
              onOpenDiff={openDiff}
            />
          ))}
        </div>
      )}

      {files.length === 0 && (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>✓</span>
          <span className={styles.emptyText}>No changes in this worktree</span>
        </div>
      )}
    </div>
  )
}

function FileRow({
  file,
  busy,
  onAction,
  actionLabel,
  actionTitle,
  onDiscard,
  onOpenDiff,
}: {
  file: FileStatus
  busy: boolean
  onAction: () => void
  actionLabel: string
  actionTitle: string
  onDiscard?: () => void
  onOpenDiff: (path: string) => void
}) {
  const parts = file.path.split('/')
  const fileName = parts.pop()
  const dir = parts.length > 0 ? parts.join('/') + '/' : ''

  return (
    <div className={styles.changedFile}>
      <span className={`${styles.statusBadge} ${styles[file.status]}`}>
        {STATUS_LABELS[file.status]}
      </span>
      <span
        className={styles.changePath}
        onClick={() => onOpenDiff(file.path)}
      >
        {dir && <span className={styles.changeDir}>{dir}</span>}
        {fileName}
      </span>
      <span className={styles.fileActions}>
        {onDiscard && (
          <Tooltip label="Discard Changes">
            <button
              className={styles.fileActionBtn}
              disabled={busy}
              onClick={onDiscard}
            >
              ↩
            </button>
          </Tooltip>
        )}
        <Tooltip label={actionTitle}>
          <button
            className={styles.fileActionBtn}
            disabled={busy}
            onClick={onAction}
          >
            {actionLabel}
          </button>
        </Tooltip>
      </span>
    </div>
  )
}
