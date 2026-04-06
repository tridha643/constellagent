import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import type { DiffAnnotation } from '@shared/diff-annotation-types'
import { useAppStore } from '../../store/app-store'
import { useFileWatcher } from '../../hooks/useFileWatcher'
import { isMarkdownDocumentPath } from '../../utils/markdown-path'
import { DiffFileSection, FileStrip, type DiffFileData } from '../Editor/DiffFileSection'
import { AnnotationsSummary } from './AnnotationsSummary'
import { resolveAnnotationPathForDiff } from '../../utils/annotation-diff-path'
import styles from './HunkReview.module.css'

interface FileStatus {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  staged: boolean
}

interface Props {
  worktreePath: string
}

function reviewToDiffAnnotations(
  rows: Awaited<ReturnType<typeof window.api.review.commentList>>,
): DiffAnnotation[] {
  return rows.map((r) => ({
    id: r.id,
    filePath: r.file_path,
    side: r.side === 'old' ? 'deletions' as const : 'additions' as const,
    lineNumber: r.line_start,
    lineEnd: r.line_end !== r.line_start ? r.line_end : undefined,
    body: r.summary,
    createdAt: r.created_at,
    resolved: r.resolved,
    author: r.author ?? undefined,
  }))
}

export function HunkReview({ worktreePath }: Props) {
  const [files, setFiles] = useState<DiffFileData[]>([])
  const [loading, setLoading] = useState(true)
  const [annotations, setAnnotations] = useState<DiffAnnotation[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const closeHunkReview = useAppStore((s) => s.closeHunkReview)
  const submitHunkReview = useAppStore((s) => s.submitHunkReview)
  const addToast = useAppStore((s) => s.addToast)
  const inline = settings.diffInline

  // ── Comment selection state ──

  const humanAnnotations = useMemo(
    () => annotations.filter((a) => !a.author),
    [annotations],
  )

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Auto-select all human comments when annotations load/change
  useEffect(() => {
    setSelectedIds(new Set(humanAnnotations.map((a) => a.id)))
  }, [humanAnnotations])

  const toggleComment = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allSelected = humanAnnotations.length > 0 && humanAnnotations.every((a) => selectedIds.has(a.id))

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(humanAnnotations.map((a) => a.id)))
    }
  }, [allSelected, humanAnnotations])

  const selectedCount = selectedIds.size

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  const openFileFromDiff = useCallback(
    (fullPath: string) => {
      if (isMarkdownDocumentPath(fullPath)) openMarkdownPreview(fullPath)
      else openFileTab(fullPath)
    },
    [openFileTab, openMarkdownPreview],
  )

  // ── Annotations (libSQL-backed) ──

  const loadAnnotations = useCallback(async () => {
    try {
      const rows = await window.api.review.commentList(worktreePath)
      setAnnotations(reviewToDiffAnnotations(rows))
    } catch (err) {
      console.error('Failed to load review annotations:', err)
      setAnnotations([])
    }
  }, [worktreePath])

  useEffect(() => {
    void loadAnnotations()
  }, [loadAnnotations])

  // Reload when annotations are cleared (e.g. after PR merge)
  useEffect(() => {
    return window.api.review.onAnnotationsCleared(() => {
      void loadAnnotations()
    })
  }, [loadAnnotations])

  // ── GitHub PR comment loading ──
  useEffect(() => {
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
        const mapped: DiffAnnotation[] = comments.map((c) => ({
          id: c.id,
          filePath: c.filePath,
          side: c.diffSide === 'LEFT' ? ('deletions' as const) : ('additions' as const),
          lineNumber: c.line ?? c.startLine ?? 1,
          body: c.body,
          createdAt: c.createdAt,
          resolved: c.resolved,
          author: c.author,
        }))
        setAnnotations((prev) => [...prev, ...mapped])
      } catch (err) {
        console.error('Failed to load PR review comments:', err)
      }
    })()
    return () => { cancelled = true }
  }, [worktreePath])

  // ── Git operations for accept/reject ──
  const handleFileAccepted = useCallback(
    async (filePath: string, status: string) => {
      try {
        await window.api.git.stage(worktreePath, [filePath])
      } catch (err) {
        console.error('Failed to stage file:', err)
        addToast({ id: `stage-err-${Date.now()}`, message: `Failed to stage ${filePath}`, type: 'error' })
      }
    },
    [worktreePath, addToast],
  )

  const handleFileRejected = useCallback(
    async (filePath: string, status: string) => {
      try {
        if (status === 'added' || status === 'untracked') {
          await window.api.git.discard(worktreePath, [], [filePath])
        } else {
          await window.api.git.discard(worktreePath, [filePath], [])
        }
      } catch (err) {
        console.error('Failed to discard file:', err)
        addToast({ id: `discard-err-${Date.now()}`, message: `Failed to discard ${filePath}`, type: 'error' })
      }
    },
    [worktreePath, addToast],
  )

  // ── Load working-tree diff ──

  const loadFiles = useCallback(async () => {
    try {
      const statuses: FileStatus[] = await window.api.git.getStatus(worktreePath)
      const results = await Promise.all(
        statuses.map(async (file) => {
          let patch = await window.api.git.getFileDiff(worktreePath, file.path)

          if (!patch && (file.status === 'added' || file.status === 'untracked')) {
            const fullPath = file.path.startsWith('/')
              ? file.path
              : `${worktreePath}/${file.path}`
            let content: string | null = null
            try {
              content = await window.api.fs.readFile(fullPath)
            } catch {
              content = null
            }
            if (content === null) return { filePath: file.path, patch: '', status: file.status }
            const lines = content.split('\n')
            patch = [
              `--- /dev/null`,
              `+++ b/${file.path}`,
              `@@ -0,0 +1,${lines.length} @@`,
              ...lines.map((l: string) => `+${l}`),
            ].join('\n')
          }

          if (!patch && file.status === 'deleted') {
            patch = `--- a/${file.path}\n+++ /dev/null\n@@ -1,0 +0,0 @@\n`
          }

          return { filePath: file.path, patch: patch || '', status: file.status }
        }),
      )
      setFiles(results)
    } catch (err) {
      console.error('Failed to load diffs:', err)
    } finally {
      setLoading(false)
    }
  }, [worktreePath])

  useEffect(() => {
    setLoading(true)
    loadFiles()
  }, [loadFiles])

  useFileWatcher(worktreePath, loadFiles, true)

  const scrollToAnnotationInDiff = useCallback(
    (annotation: DiffAnnotation) => {
      const resolved = resolveAnnotationPathForDiff(
        annotation.filePath,
        files.map((f) => f.filePath),
      )
      if (!resolved) {
        addToast({
          id: `ann-jump-${Date.now()}`,
          message: `File not in current diff: ${annotation.filePath}`,
          type: 'warning',
        })
        return
      }
      const fileEl = document.getElementById(`diff-${resolved}`)
      const bubble = document.querySelector(`[data-annotation-id="${annotation.id}"]`)
      const target = (bubble ?? fileEl) as HTMLElement | null
      if (!target) {
        addToast({
          id: `ann-jump-${Date.now()}`,
          message: 'Could not find annotation in diff view',
          type: 'warning',
        })
        return
      }
      const root = scrollAreaRef.current
      if (root) {
        const rootRect = root.getBoundingClientRect()
        const elRect = target.getBoundingClientRect()
        const top = elRect.top - rootRect.top + root.scrollTop
        root.scrollTo({ top: Math.max(0, top - 12), behavior: 'smooth' })
      } else {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
      requestAnimationFrame(() => {
        const b = document.querySelector(`[data-annotation-id="${annotation.id}"]`)
        if (b) {
          b.classList.add('highlightFlash')
          setTimeout(() => b.classList.remove('highlightFlash'), 1200)
        } else if (fileEl) {
          fileEl.classList.add('highlightFlash')
          setTimeout(() => fileEl.classList.remove('highlightFlash'), 1200)
        }
      })
    },
    [files, addToast],
  )

  // IntersectionObserver to highlight active file in strip
  useEffect(() => {
    if (!scrollAreaRef.current || files.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id
            if (id.startsWith('diff-')) {
              setActiveFile(id.slice(5))
            }
          }
        }
      },
      { root: scrollAreaRef.current, threshold: 0.3 },
    )

    for (const f of files) {
      const el = document.getElementById(`diff-${f.filePath}`)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [files])

  return (
    <>
      {/* Backdrop */}
      <div className={styles.backdrop} onClick={closeHunkReview} />

      {/* Panel */}
      <div
        className={styles.panel}
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            closeHunkReview()
          }
        }}
      >
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.title}>Review Changes</span>
          {files.length > 0 && (
            <span className={styles.badge}>
              {files.length} file{files.length !== 1 ? 's' : ''}
            </span>
          )}
          {humanAnnotations.length > 0 && (
            <button className={styles.selectAllBtn} onClick={toggleAll}>
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
          )}
          <div className={styles.headerSpacer} />
          <div className={styles.toggleGroup}>
            <button
              className={`${styles.toggleOption} ${!inline ? styles.active : ''}`}
              onClick={() => updateSettings({ diffInline: false })}
            >
              Split
            </button>
            <button
              className={`${styles.toggleOption} ${inline ? styles.active : ''}`}
              onClick={() => updateSettings({ diffInline: true })}
            >
              Inline
            </button>
          </div>
          <button
            className={styles.submitBtn}
            disabled={selectedCount === 0}
            onClick={() => void submitHunkReview(selectedIds)}
          >
            Submit Review{selectedCount > 0 ? ` (${selectedCount})` : ''}
          </button>
          <button className={styles.closeBtn} onClick={closeHunkReview}>
            &times;
          </button>
        </div>

        {/* Hint */}
        <p className={styles.hint}>
          Hover a line and click + to comment, or drag across line numbers for a range.
          Submit sends selected comments to the agent.
        </p>

        {/* File strip */}
        {files.length > 0 && <FileStrip files={files} activeFile={activeFile} />}

        {/* Annotations summary from constell-annotate SQLite DB */}
        <AnnotationsSummary
          annotations={annotations}
          worktreePath={worktreePath}
          onAnnotationsChanged={loadAnnotations}
          selectedIds={selectedIds}
          onToggleComment={toggleComment}
          onJumpToAnnotation={scrollToAnnotationInDiff}
        />

        {/* Content */}
        {loading ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyText}>Loading changes...</span>
          </div>
        ) : files.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>&#10003;</span>
            <span className={styles.emptyText}>No changes</span>
          </div>
        ) : (
          <div ref={scrollAreaRef} className={styles.scrollArea}>
            {files.map((f) => (
              <DiffFileSection
                key={f.filePath}
                data={f}
                inline={inline}
                worktreePath={worktreePath}
                onOpenFile={openFileFromDiff}
                worktreeAnnotations={annotations}
                onAnnotationsChanged={loadAnnotations}
                showPatchAnchorNote={false}
                selectedCommentIds={selectedIds}
                onToggleComment={toggleComment}
                enableAcceptReject
                onFileAccepted={(fp, status) => void handleFileAccepted(fp, status)}
                onFileRejected={(fp, status) => void handleFileRejected(fp, status)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
