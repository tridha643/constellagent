import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnnotationPatch, DiffAnnotation } from '@shared/diff-annotation-types'
import { useAppStore } from '../../store/app-store'
import { buildReviewThreadsByFile, type ReviewThreadsByFile } from './review-threads'

/**
 * Preserve object identity for unchanged rows so memos / CodeView item versions
 * don't bust on a no-op reconcile.
 */
function mergeAnnotations(prev: DiffAnnotation[], next: DiffAnnotation[]): DiffAnnotation[] {
  const prevById = new Map(prev.map((a) => [a.id, a]))
  let changed = prev.length !== next.length
  const merged = next.map((row) => {
    const existing = prevById.get(row.id)
    if (
      existing &&
      existing.body === row.body &&
      existing.resolved === row.resolved &&
      existing.lineNumber === row.lineNumber &&
      existing.lineEnd === row.lineEnd &&
      existing.filePath === row.filePath &&
      existing.side === row.side &&
      existing.author === row.author &&
      existing.createdAt === row.createdAt &&
      existing.rationale === row.rationale
    ) {
      return existing
    }
    changed = true
    return row
  })
  return changed ? merged : prev
}

export interface ReviewThreadsState {
  annotations: DiffAnnotation[]
  reviewThreadsByFile: ReviewThreadsByFile
  applyAnnotationPatch: (patch: AnnotationPatch) => void
}

/**
 * Merge every comment source — local libSQL (`REVIEW_COMMENT_LIST`) + GitHub PR
 * review comments (`getPrReviewComments`) — into one annotation list and a
 * `Map<path, FileReviewThreads>`. libSQL rows reconcile locally (optimistic
 * patches); PR rows are kept in a separate slice so a reconcile never clobbers
 * them. Drift reconcile on focus + `git:files-changed` + `REVIEW_ANNOTATIONS_CLEARED`.
 */
export function useReviewThreads(opts: {
  worktreePath: string
  active: boolean
  commitHash?: string
}): ReviewThreadsState {
  const { worktreePath, active, commitHash } = opts

  const [localAnnotations, setLocalAnnotations] = useState<DiffAnnotation[]>([])
  const [prAnnotations, setPrAnnotations] = useState<DiffAnnotation[]>([])
  const reconcileGenerationRef = useRef(0)

  const reconcileAnnotations = useCallback(async () => {
    const generation = ++reconcileGenerationRef.current
    try {
      const rows = await window.api.review.commentList(worktreePath)
      if (reconcileGenerationRef.current !== generation) return
      const next: DiffAnnotation[] = rows.map((r) => ({
        id: r.id,
        filePath: r.file_path,
        side: r.side === 'old' ? ('deletions' as const) : ('additions' as const),
        lineNumber: r.line_start,
        lineEnd: r.line_end !== r.line_start ? r.line_end : undefined,
        body: r.summary,
        rationale: r.rationale ?? undefined,
        createdAt: r.created_at,
        resolved: r.resolved,
        author: r.author ?? undefined,
      }))
      setLocalAnnotations((prev) => mergeAnnotations(prev, next))
    } catch (err) {
      console.error('Failed to load review annotations:', err)
    }
  }, [worktreePath])

  const applyAnnotationPatch = useCallback((patch: AnnotationPatch) => {
    setLocalAnnotations((prev) => {
      switch (patch.type) {
        case 'insert':
          if (prev.some((a) => a.id === patch.annotation.id)) return prev
          return [...prev, patch.annotation]
        case 'update': {
          let mutated = false
          const next = prev.map((a) => {
            if (a.id !== patch.id) return a
            mutated = true
            return { ...a, ...patch.changes }
          })
          return mutated ? next : prev
        }
        case 'remove':
        case 'rollback-insert': {
          const next = prev.filter((a) => a.id !== patch.id)
          return next.length === prev.length ? prev : next
        }
        case 'rollback-restore':
          if (prev.some((a) => a.id === patch.annotation.id)) return prev
          return [...prev, patch.annotation]
        default:
          return prev
      }
    })
  }, [])

  useEffect(() => {
    if (!active) return
    void reconcileAnnotations()
  }, [active, reconcileAnnotations])

  useEffect(() => {
    const onFocus = () => { void reconcileAnnotations() }
    const onGitChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ worktreePath?: string }>).detail
      if (detail?.worktreePath && detail.worktreePath !== worktreePath) return
      void reconcileAnnotations()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('git:files-changed', onGitChanged)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('git:files-changed', onGitChanged)
    }
  }, [reconcileAnnotations, worktreePath])

  useEffect(() => {
    return window.api.review.onAnnotationsCleared(() => { void reconcileAnnotations() })
  }, [reconcileAnnotations])

  // GitHub PR review comments — pulled on demand, keyed off prStatusMap.
  useEffect(() => {
    if (!active || commitHash) return
    let cancelled = false
    ;(async () => {
      try {
        const branch = await window.api.git.getCurrentBranch(worktreePath)
        if (!branch || cancelled) return
        const { projects, workspaces, prStatusMap } = useAppStore.getState()
        const ws = workspaces.find((w) => w.worktreePath === worktreePath)
        if (!ws) return
        const project = projects.find((p) => p.id === ws.projectId)
        if (!project) return
        const prInfo = prStatusMap.get(`${project.id}:${branch}`)
        if (!prInfo?.number) return
        const comments = await window.api.github.getPrReviewComments(worktreePath, prInfo.number)
        if (cancelled) return
        setPrAnnotations(comments.map((c) => ({
          id: c.id,
          filePath: c.filePath,
          side: c.diffSide === 'LEFT' ? ('deletions' as const) : ('additions' as const),
          lineNumber: c.line ?? c.startLine ?? 1,
          body: c.body,
          rationale: undefined,
          createdAt: c.createdAt,
          resolved: c.resolved,
          author: c.author,
        })))
      } catch (err) {
        console.error('Failed to load PR review comments:', err)
      }
    })()
    return () => { cancelled = true }
  }, [active, worktreePath, commitHash])

  const annotations = useMemo(
    () => [...localAnnotations, ...prAnnotations],
    [localAnnotations, prAnnotations],
  )
  const reviewThreadsByFile = useMemo(() => buildReviewThreadsByFile(annotations), [annotations])

  return { annotations, reviewThreadsByFile, applyAnnotationPatch }
}
