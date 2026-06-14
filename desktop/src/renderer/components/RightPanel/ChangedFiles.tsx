import { useEffect, useState, useCallback, useMemo, useRef, memo } from 'react'
import { Columns2 } from 'lucide-react'
import { useAppStore } from '../../store/app-store'
import { STATUS_LABELS } from '../../../shared/status-labels'
import { useFileWatcher } from '../../hooks/useFileWatcher'
import { createTrailingDebounce } from '../../utils/debounce'
import { Tooltip } from '../Tooltip/Tooltip'
import { PiIcon } from '../Icons/PiIcon'
import styles from './RightPanel.module.css'
import { registerChangesFindSource } from '../../utils/changes-file-find-bridge'
import { buildWorkingTreeStatusSignature } from '../../types/working-tree-diff'
import {
  normalizeWorkspaceBranch,
  preserveWorkspaceBranch,
} from '../../store/workspace-branch'
import {
  normalizeConflictResolverAgent,
  normalizeConflictResolverModel,
} from '../../store/types'
import type { PlanAgent } from '../../../shared/agent-plan-path'
import { buildAdHocAgentCommand } from '../../../shared/plan-build-command'
import { formatRebaseConflictAgentPrompt } from '../../agents/conflict-prompt'

const PR_POLL_HINT_EVENT = 'constellagent:pr-poll-hint'
// Coalesce file-watcher bursts into one status refresh.
const CHANGED_FILES_REFRESH_DEBOUNCE_MS = 120

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

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim()
  return fallback
}

export function ChangedFiles({ worktreePath, workspaceId, isActive }: Props) {
  // Local-first seed: render the last-known working-tree statuses from the
  // in-memory snapshot synchronously on first paint instead of waiting on a git
  // round-trip. Mirrors the diff viewer's warm-snapshot reuse (DiffEditor.loadFiles).
  const [files, setFiles] = useState<FileStatus[]>(
    () => useAppStore.getState().workingTreeDiffSnapshots.get(worktreePath)?.statuses ?? [],
  )
  const [loading, setLoading] = useState(
    () => !useAppStore.getState().workingTreeDiffSnapshots.get(worktreePath),
  )
  const [busy, setBusy] = useState(false)
  const [busyAction, setBusyAction] = useState<'commit' | 'pr' | 'graphite' | 'generate-commit-message' | null>(null)
  const [busyLabel, setBusyLabel] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [currentBranch, setCurrentBranch] = useState('')
  const [defaultBranch, setDefaultBranch] = useState('')
  const [defaultBranchLoading, setDefaultBranchLoading] = useState(true)
  const [commitInputFlash, setCommitInputFlash] = useState(false)
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null)
  const commitFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openDiffTab = useAppStore((s) => s.openDiffTab)
  const openFullFileDiffTab = useAppStore((s) => s.openFullFileDiffTab)
  const setGitFileStatuses = useAppStore((s) => s.setGitFileStatuses)
  const updateGitStatusSnapshot = useAppStore((s) => s.updateGitStatusSnapshot)
  const addToast = useAppStore((s) => s.addToast)
  const setPrStatuses = useAppStore((s) => s.setPrStatuses)
  const setGhAvailability = useAppStore((s) => s.setGhAvailability)
  const updateWorkspaceBranch = useAppStore((s) => s.updateWorkspaceBranch)
  const setProjectDefaultBranch = useAppStore((s) => s.setProjectDefaultBranch)
  const launchAgentTerminalWithCommand = useAppStore((s) => s.launchAgentTerminalWithCommand)
  const [isAheadOfRemote, setIsAheadOfRemote] = useState(false)

  // Granular store reads: select only this workspace / project / PR entry (the
  // store preserves object identity for untouched entries) so PR polls, settings
  // changes, and unrelated workspace updates don't re-render the whole panel.
  const workspace = useAppStore((s) => s.workspaces.find((ws) => ws.id === workspaceId))
  const project = useAppStore((s) => (workspace ? s.projects.find((p) => p.id === workspace.projectId) : undefined))
  const branch = normalizeWorkspaceBranch(currentBranch || workspace?.branch || '')
  const prInfo = useAppStore((s) => (project && branch ? s.prStatusMap.get(`${project.id}:${branch}`) ?? null : null))
  const conflictResolverAgent = useAppStore((s) => s.settings.conflictResolverAgent)
  const conflictResolverModel = useAppStore((s) => s.settings.conflictResolverModel)

  const refresh = useCallback(async () => {
    try {
      const [statuses, headHash] = await Promise.all([
        window.api.git.getStatus(worktreePath),
        window.api.git.getHeadHash(worktreePath),
      ])
      setFiles(statuses)
      updateGitStatusSnapshot(worktreePath, {
        statuses,
        headHash,
        signature: buildWorkingTreeStatusSignature(statuses, headHash),
        updatedAt: Date.now(),
      })
    } catch {
      // Best effort — empty state already communicates enough.
    } finally {
      setLoading(false)
    }
  }, [worktreePath, updateGitStatusSnapshot])

  // Coalesce watcher / git:files-changed bursts (e.g. an agent writing many
  // files) into one refresh; explicit refresh() calls after user git ops stay
  // immediate. Stable instance + ref so it always runs the latest refresh.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const scheduleRefresh = useMemo(
    () => createTrailingDebounce(() => refreshRef.current(), CHANGED_FILES_REFRESH_DEBOUNCE_MS),
    [],
  )
  useEffect(() => () => scheduleRefresh.cancel(), [scheduleRefresh])

  useEffect(() => {
    let cancelled = false
    if (!workspace) {
      setCurrentBranch('')
      return
    }

    window.api.git.getCurrentBranch(worktreePath).then((actual) => {
      if (cancelled) return
      const resolvedBranch = preserveWorkspaceBranch(workspace.branch, actual)
      setCurrentBranch(resolvedBranch || workspace.branch)
      if (resolvedBranch && resolvedBranch !== workspace.branch) {
        updateWorkspaceBranch(workspace.id, resolvedBranch)
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
        const normalized = normalizeWorkspaceBranch(resolved)
        setDefaultBranch(normalized)
        setDefaultBranchLoading(false)
        if (normalized) {
          setProjectDefaultBranch(project.id, normalized)
        }
      })
      .catch(() => {
        if (cancelled) return
        setDefaultBranch('')
        setDefaultBranchLoading(false)
      })

    return () => { cancelled = true }
  }, [project, setProjectDefaultBranch])

  const refreshPrStatus = useCallback(async (targetBranch?: string) => {
    const effectiveBranch = (targetBranch ?? branch).trim()
    if (!project || !effectiveBranch) return
    try {
      const linkedPrNumber = workspace?.linkedPullRequest?.number
      const result = typeof linkedPrNumber === 'number' && linkedPrNumber > 0
        ? await window.api.github.getPrStatusesByNumber(project.repoPath, [linkedPrNumber])
        : await window.api.github.getPrStatuses(project.repoPath, [effectiveBranch])
      setGhAvailability(project.id, result.available)
      if (result.available) {
        if (typeof linkedPrNumber === 'number' && linkedPrNumber > 0) {
          setPrStatuses(project.id, { [effectiveBranch]: result.data[String(linkedPrNumber)] ?? null })
        } else {
          setPrStatuses(project.id, result.data)
        }
      }
    } catch {
      // PR status is best-effort here; the global poller will keep things fresh.
    }
  }, [branch, project, setGhAvailability, setPrStatuses, workspace])

  useEffect(() => {
    if (!isActive || !project || !branch) return
    void refreshPrStatus()
  }, [isActive, project, branch, refreshPrStatus])

  useEffect(() => () => {
    if (commitFlashTimerRef.current) clearTimeout(commitFlashTimerRef.current)
  }, [])

  // Watch filesystem for changes and auto-refresh (debounced to coalesce bursts)
  useFileWatcher(worktreePath, scheduleRefresh, Boolean(isActive))

  // Explicit refresh after checkpoint restore / git ops that bypass FS watcher timing
  useEffect(() => {
    if (!isActive) return
    const onGitFilesChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ worktreePath?: string }>).detail
      if (detail?.worktreePath === worktreePath) scheduleRefresh()
    }
    window.addEventListener('git:files-changed', onGitFilesChanged)
    return () => window.removeEventListener('git:files-changed', onGitFilesChanged)
  }, [worktreePath, scheduleRefresh, isActive])

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

  const staged = useMemo(() => files.filter((f) => f.staged), [files])
  const unstaged = useMemo(() => files.filter((f) => !f.staged), [files])
  const commitMessage = commitMsg.trim()
  const hasOpenPr = prInfo?.state === 'open'
  const linkedPushRemote = workspace?.linkedPullRequest?.pushRemote || 'origin'
  const linkedPushRef = workspace?.linkedPullRequest?.headRefName || branch
  const resolvedPushRemote = workspace?.linkedPullRequest ? linkedPushRemote : 'origin'
  const resolvedPushRef = workspace?.linkedPullRequest ? linkedPushRef : branch
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

  const isGraphiteDefaultBranch =
    !!project
    && !defaultBranchLoading
    && !!defaultBranch
    && isRenderableBranch
    && branch === defaultBranch
  const graphiteVisible = isGraphiteDefaultBranch && staged.length > 0
  const graphiteDisabled = busy || !commitMessage
  // Resume-push case: after an agent resolves a rebase the working tree may be clean,
  // but we still want the Commit button so the user can push the already-committed change.
  const canResumePush = hasOpenPr && isAheadOfRemote && staged.length === 0
  const showControls = !!prActionMode || graphiteVisible || files.length > 0 || canResumePush

  // Track whether HEAD is ahead of the resolved push target so the Commit button
  // can stay enabled with no staged changes after the conflict-resolver agent
  // finishes a rebase — letting the user click Commit just to push.
  useEffect(() => {
    let cancelled = false
    if (!hasOpenPr || !resolvedPushRef) {
      setIsAheadOfRemote(false)
      return
    }
    window.api.git
      .isAheadOfRemote(worktreePath, resolvedPushRemote, resolvedPushRef)
      .then((ahead) => {
        if (!cancelled) setIsAheadOfRemote(ahead)
      })
      .catch(() => {
        if (!cancelled) setIsAheadOfRemote(false)
      })
    return () => {
      cancelled = true
    }
  }, [worktreePath, hasOpenPr, resolvedPushRemote, resolvedPushRef, files])

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

  // Optimistically flip the staged flag for the given paths so a row jumps
  // between the Staged / Unstaged groups the instant it's clicked, instead of
  // freezing behind the global busy spinner until git returns. The op runs in
  // the background and refresh() reconciles to real git state in `finally` —
  // which also reverts the optimistic flip if the op throws. Mirrors the
  // optimistic-update pattern already used for Linear issue drag-drop.
  const runStagingOp = useCallback(async (
    paths: string[],
    staged: boolean,
    op: () => Promise<void>,
    fallback: string,
  ) => {
    if (paths.length === 0) return
    const target = new Set(paths)
    setFiles((prev) => prev.map((f) => (target.has(f.path) ? { ...f, staged } : f)))
    try {
      await op()
    } catch (err) {
      console.error('[ChangedFiles] staging operation failed:', err)
      addToast({
        id: crypto.randomUUID(),
        message: errorMessage(err, fallback),
        type: 'error',
      })
    } finally {
      await refresh()
    }
  }, [addToast, refresh])

  const stageFiles = useCallback((paths: string[]) => {
    void runStagingOp(paths, true, () => window.api.git.stage(worktreePath, paths), 'Failed to stage changes')
  }, [worktreePath, runStagingOp])

  const unstageFiles = useCallback((paths: string[]) => {
    void runStagingOp(paths, false, () => window.api.git.unstage(worktreePath, paths), 'Failed to unstage changes')
  }, [worktreePath, runStagingOp])

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

  // Stable per-file handlers (FileRow passes its own file back) so memoized rows
  // don't re-render from fresh closures created on every parent render.
  const stageFile = useCallback((file: FileStatus) => {
    stageFiles([file.path])
  }, [stageFiles])

  const unstageFile = useCallback((file: FileStatus) => {
    unstageFiles([file.path])
  }, [unstageFiles])

  const handleGenerateCommitMessage = useCallback(async () => {
    if (files.length === 0) return

    setBusy(true)
    setBusyAction('generate-commit-message')
    setBusyLabel('Generating…')

    try {
      const message = await window.api.app.generateCommitMessage(worktreePath)
      setCommitMsg(message)
      if (commitFlashTimerRef.current) clearTimeout(commitFlashTimerRef.current)
      setCommitInputFlash(true)
      commitFlashTimerRef.current = setTimeout(() => {
        setCommitInputFlash(false)
        commitFlashTimerRef.current = null
      }, 220)
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
    // Two entry points share this handler:
    //   1) Normal: at least one staged file. We commit, then push when an open PR exists.
    //   2) Resume-push after agent-resolved rebase: no staged files, but HEAD is ahead of the
    //      open PR's push target. Skip the commit step; go straight to push.
    const resumePushOnly = staged.length === 0 && hasOpenPr && isAheadOfRemote
    if (!resumePushOnly && (!commitMessage || staged.length === 0)) return

    const committedPaths = staged.map((f) => f.path)
    setBusy(true)
    setBusyAction('commit')
    setBusyLabel(resumePushOnly ? 'Pushing…' : 'Committing…')

    const doPush = async () => {
      if (workspace?.linkedPullRequest) {
        await window.api.git.pushToPrHead(
          worktreePath,
          workspace.linkedPullRequest.pushRemote,
          workspace.linkedPullRequest.headRefName,
        )
      } else {
        await window.api.git.pushCurrentBranch(worktreePath)
      }
    }

    try {
      if (!resumePushOnly) {
        await window.api.git.commit(worktreePath, commitMessage)
        setCommitMsg('')
        window.dispatchEvent(new CustomEvent('git:files-changed', {
          detail: { worktreePath, paths: committedPaths },
        }))
      }

      if (hasOpenPr) {
        setBusyLabel('Pushing…')
        try {
          await doPush()
        } catch (pushErr) {
          // Non-fast-forward (or any push failure). Try one auto-recovery: fetch + rebase.
          // We never roll back the local commit — that matches git's own semantics.
          console.warn('[ChangedFiles] push failed, attempting fetch + rebase recovery', pushErr)
          setBusyLabel('Rebasing…')
          const remote = workspace?.linkedPullRequest?.pushRemote || 'origin'
          const ref = workspace?.linkedPullRequest?.headRefName || branch
          let rebaseRes: { ok: true } | { ok: false; kind: 'conflict'; files: string[] }
          try {
            rebaseRes = await window.api.git.fetchAndRebase(worktreePath, remote, ref)
          } catch (rebaseErr) {
            // Non-conflict rebase failure (network, refusal, etc.). Surface the underlying push error
            // since that's the user's mental model ("Commit pushed but git complained").
            console.error('[ChangedFiles] fetch+rebase recovery failed:', rebaseErr)
            addToast({
              id: crypto.randomUUID(),
              message: errorMessage(rebaseErr, errorMessage(pushErr, 'Failed to push to remote')),
              type: 'error',
            })
            return
          }
          if (rebaseRes.ok) {
            setBusyLabel('Pushing…')
            await doPush()
          } else {
            // Conflicted rebase — hand off to the configured agent. The local commit stays;
            // the rebase is left mid-flight; the user re-clicks Commit after the agent finishes.
            setBusyLabel('Launching agent…')
            const agent = normalizeConflictResolverAgent(conflictResolverAgent)
            const model = normalizeConflictResolverModel(conflictResolverModel).trim() || null
            const prompt = formatRebaseConflictAgentPrompt({
              branch,
              pushRemote: remote,
              pushRef: ref,
              conflictedFiles: rebaseRes.files,
            })
            const { command } = buildAdHocAgentCommand(agent as PlanAgent, model, prompt)
            try {
              await launchAgentTerminalWithCommand({
                workspaceId,
                worktreePath,
                title: 'Resolve rebase conflict',
                command,
                agentType: agent,
              })
            } catch (launchErr) {
              console.error('[ChangedFiles] failed to launch conflict-resolver agent:', launchErr)
            }
            addToast({
              id: crypto.randomUUID(),
              message: `Rebase conflict — ${agent} is resolving it. Click Commit again when it's done.`,
              type: 'warning',
            })
          }
        }
      }
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
  }, [
    addToast,
    branch,
    commitMessage,
    conflictResolverAgent,
    conflictResolverModel,
    hasOpenPr,
    isAheadOfRemote,
    launchAgentTerminalWithCommand,
    refresh,
    staged,
    workspace,
    workspaceId,
    worktreePath,
  ])

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
        if (workspace?.linkedPullRequest) {
          await window.api.git.pushToPrHead(
            worktreePath,
            workspace.linkedPullRequest.pushRemote,
            workspace.linkedPullRequest.headRefName,
          )
        } else {
          await window.api.git.pushCurrentBranch(worktreePath)
        }
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

  const runGraphiteStackAction = useCallback(async () => {
    if (!project || !defaultBranch) return
    if (!graphiteVisible || graphiteDisabled) return

    setBusy(true)
    setBusyAction('graphite')
    setBusyLabel('Starting stack...')

    try {
      const result = await window.api.graphite.runStackAction(
        project.repoPath,
        worktreePath,
        'start-stack',
        commitMessage,
        defaultBranch,
        null,
      )

      if (result.branch) {
        setCurrentBranch(result.branch)
        updateWorkspaceBranch(workspaceId, result.branch)
        await refreshPrStatus(result.branch)
        window.dispatchEvent(new CustomEvent(PR_POLL_HINT_EVENT, {
          detail: { worktreePath, branch: result.branch, kind: 'pr' },
        }))
      }

      setCommitMsg('')
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
    graphiteDisabled,
    graphiteVisible,
    project,
    refresh,
    refreshPrStatus,
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

  const openFullDiff = useCallback((file: FileStatus) => {
    openFullFileDiffTab(file.path, { status: file.status })
  }, [openFullFileDiffTab])

  useEffect(() => {
    if (!isActive) return
    return registerChangesFindSource('changes-panel', () => {
      if (files.length === 0) return null
      return {
        worktreePath,
        paths: files.map((f) => f.path),
        onPick: (path) => { openDiff(path) },
      }
    })
  }, [isActive, worktreePath, files, openDiff])

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
          <div
            className={`${styles.commitInputCompound} ${commitInputFlash ? styles.commitInputCompoundFlash : ''}`}
          >
            <textarea
              ref={commitInputRef}
              className={styles.commitInput}
              placeholder={'Message (\u2318\u21b5 to commit)'}
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
            <div className={styles.commitActionSlot}>
              <Tooltip label="Commit staged changes" shortcut="⌘↵">
                <button
                  type="button"
                  className={`${styles.commitButton} ${(prActionMode || graphiteVisible) ? styles.commitButtonSecondary : ''}`}
                  disabled={
                    busy ||
                    // Allow re-click after the conflict-resolver agent finishes:
                    // staged is empty but HEAD is ahead of the open PR's push target,
                    // so the click just runs the push step.
                    (staged.length === 0
                      ? !(hasOpenPr && isAheadOfRemote)
                      : !commitMessage)
                  }
                  onClick={() => { void handleCommit() }}
                >
                  <span className={styles.commitButtonLabel}>
                    {busy && busyAction === 'commit' && busyLabel ? busyLabel : 'Commit'}
                  </span>
                </button>
              </Tooltip>
            </div>
            {prActionMode && (
              <div className={styles.commitActionSlot}>
                <Tooltip label={prTooltipLabel}>
                  <button
                    type="button"
                    className={`${styles.commitButton} ${styles.prActionButton}`}
                    disabled={prActionDisabled}
                    onClick={() => { void handlePrAction() }}
                  >
                    <span className={styles.commitButtonLabel}>
                      {busy && busyAction === 'pr' && busyLabel ? busyLabel : prActionLabel}
                    </span>
                  </button>
                </Tooltip>
              </div>
            )}
            {graphiteVisible && (
              <div className={styles.commitActionSlot}>
                <Tooltip label="Create a draft Graphite stack from staged changes">
                  <button
                    type="button"
                    className={`${styles.commitButton} ${styles.prActionButton}`}
                    disabled={graphiteDisabled}
                    onClick={() => { void runGraphiteStackAction() }}
                  >
                    <span className={styles.commitButtonLabel}>
                      {busy && busyAction === 'graphite' && busyLabel ? busyLabel : 'Start Stack'}
                    </span>
                  </button>
                </Tooltip>
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
              onAction={unstageFile}
              actionLabel="−"
              actionTitle="Unstage"
              onOpenDiff={openDiff}
              onOpenFullDiff={openFullDiff}
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
              onAction={stageFile}
              actionLabel="+"
              actionTitle="Stage"
              onDiscard={discardFiles}
              onOpenDiff={openDiff}
              onOpenFullDiff={openFullDiff}
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

// Memoized so commit-message keystrokes / busy toggles in the parent don't
// re-render every row (each row carries multiple stateful Tooltip portals).
// All callback props receive the row's own file, so the parent can pass the
// same stable handler to every row.
const FileRow = memo(function FileRow({
  file,
  busy,
  onAction,
  actionLabel,
  actionTitle,
  onDiscard,
  onOpenDiff,
  onOpenFullDiff,
}: {
  file: FileStatus
  busy: boolean
  onAction: (file: FileStatus) => void
  actionLabel: string
  actionTitle: string
  onDiscard?: (file: FileStatus) => void
  onOpenDiff: (path: string) => void
  onOpenFullDiff: (file: FileStatus) => void
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
        <Tooltip label="Open side-by-side diff">
          <button
            className={styles.fileActionBtn}
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); onOpenFullDiff(file) }}
            aria-label="Open side-by-side diff"
          >
            <Columns2 size={12} />
          </button>
        </Tooltip>
        {onDiscard && (
          <Tooltip label="Discard Changes">
            <button
              className={styles.fileActionBtn}
              disabled={busy}
              onClick={() => onDiscard(file)}
            >
              ↩
            </button>
          </Tooltip>
        )}
        <Tooltip label={actionTitle}>
          <button
            className={styles.fileActionBtn}
            disabled={busy}
            onClick={() => onAction(file)}
          >
            {actionLabel}
          </button>
        </Tooltip>
      </span>
    </div>
  )
})
