import { useEffect, useState, useCallback, useRef } from 'react'
import type { DiffAnnotation } from '@shared/diff-annotation-types'
import { useAppStore } from '../../store/app-store'
import { useFileWatcher } from '../../hooks/useFileWatcher'
import { isMarkdownDocumentPath } from '../../utils/markdown-path'
import { DiffFileSection, FileStrip, type DiffFileData } from './DiffFileSection'
import styles from './Editor.module.css'

interface FileStatus {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  staged: boolean
}

interface Props {
  worktreePath: string
  active: boolean
  commitHash?: string
  commitMessage?: string
}

/** Unescape minimal C-style sequences Git uses in quoted diff paths. */
function unquoteGitPath(s: string): string {
  return s.replace(/\\([\\"])/g, '$1')
}

/**
 * Prefer `+++ b/…` / `--- a/…` (unified diff); fall back to first `diff --git` line; then `unknown`.
 */
function extractFilePathFromGitPatchSegment(part: string): string {
  const lines = part.split('\n')
  for (const line of lines) {
    if (line.startsWith('+++ /dev/null')) continue
    const quotedPlus = line.match(/^\+\+\+ "b\/((?:[^"\\]|\\.)*)"(?:\t.*)?$/)
    if (quotedPlus) return unquoteGitPath(quotedPlus[1])
    const plainPlus = line.match(/^\+\+\+ b\/(.+?)(?:\t|$)/)
    if (plainPlus) return plainPlus[1]
  }
  for (const line of lines) {
    if (!line.startsWith('--- a/') && !line.startsWith('--- "a/')) continue
    const quotedMinus = line.match(/^--- "a\/((?:[^"\\]|\\.)*)"(?:\t.*)?$/)
    if (quotedMinus) return unquoteGitPath(quotedMinus[1])
    const plainMinus = line.match(/^--- a\/(.+?)(?:\t|$)/)
    if (plainMinus) return plainMinus[1]
  }
  const firstLine = lines[0] || ''
  const diffCc = firstLine.match(/^diff --cc (.+)$/)
  if (diffCc) return diffCc[1].trim()
  const quotedGit = firstLine.match(/"b\/((?:[^"\\]|\\.)*)"\s*$/)
  if (quotedGit) return unquoteGitPath(quotedGit[1])
  const plainGit = firstLine.match(/\bb\/(.+)$/)
  if (plainGit) return plainGit[1]
  return 'unknown'
}

/** Split `git show` output into one blob per file (`diff --git` or merge `diff --cc`). */
function splitGitShowPatchIntoFiles(patchOutput: string): string[] {
  const trimmed = patchOutput.trimEnd()
  if (!trimmed) return []
  const headerRe = /^diff --(?:git|cc) /gm
  const matches = [...trimmed.matchAll(headerRe)]
  if (matches.length === 0) return [trimmed]
  return matches.map((m, i) => {
    const start = m.index!
    const end = i + 1 < matches.length ? (matches[i + 1]!.index as number) : trimmed.length
    return trimmed.slice(start, end).trimEnd()
  })
}

// ── Main DiffViewer ──

export function DiffViewer({ worktreePath, active, commitHash, commitMessage }: Props) {
  const [files, setFiles] = useState<DiffFileData[]>([])
  const [loading, setLoading] = useState(true)
  const [annotations, setAnnotations] = useState<DiffAnnotation[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const inline = settings.diffInline

  const openFileFromDiff = useCallback(
    (fullPath: string) => {
      if (isMarkdownDocumentPath(fullPath)) openMarkdownPreview(fullPath)
      else openFileTab(fullPath)
    },
    [openFileTab, openMarkdownPreview],
  )

  const loadAnnotations = useCallback(async () => {
    try {
      const comments = await window.api.hunk.commentList(worktreePath)
      setAnnotations(
        comments.map((c) => ({
          id: c.id,
          filePath: c.file,
          side: 'additions' as const,
          lineNumber: c.newLine ?? c.oldLine ?? 1,
          body: c.summary,
          createdAt: new Date().toISOString(),
          resolved: false,
          author: c.author,
        })),
      )
    } catch (err) {
      console.error('Failed to load hunk comments:', err)
      setAnnotations([])
    }
  }, [worktreePath])

  useEffect(() => {
    void loadAnnotations()
  }, [loadAnnotations])

  // Load commit-specific diff
  const loadCommitDiff = useCallback(async () => {
    if (!commitHash) return
    try {
      const patchOutput = await window.api.git.getCommitDiff(worktreePath, commitHash)
      if (!patchOutput) {
        setFiles([])
        return
      }
      const parts = splitGitShowPatchIntoFiles(patchOutput)
      const results: DiffFileData[] = parts.map((part) => ({
        filePath: extractFilePathFromGitPatchSegment(part),
        patch: part,
        status: 'modified', // commit diffs don't distinguish status easily
      }))
      setFiles(results)
    } catch (err) {
      console.error('Failed to load commit diff:', err)
    } finally {
      setLoading(false)
    }
  }, [worktreePath, commitHash])

  // Load working-tree changed files
  const loadFiles = useCallback(async () => {
    if (commitHash) return // handled by loadCommitDiff
    try {
      const statuses: FileStatus[] = await window.api.git.getStatus(worktreePath)
      const results = await Promise.all(
        statuses.map(async (file) => {
          let patch = await window.api.git.getFileDiff(worktreePath, file.path)

          // For added/untracked files, git diff returns empty — build synthetic patch
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

          // For deleted files with no diff, build synthetic removal patch
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
  }, [worktreePath, commitHash])

  useEffect(() => {
    setLoading(true)
    if (commitHash) {
      loadCommitDiff()
    } else {
      loadFiles()
    }
  }, [commitHash, loadCommitDiff, loadFiles])

  // Auto-refresh on filesystem changes (only for working-tree diffs)
  useFileWatcher(worktreePath, loadFiles, !commitHash)

  // Listen for scroll-to-file events from ChangedFiles panel
  useEffect(() => {
    const handler = (e: Event) => {
      const filePath = (e as CustomEvent<string>).detail
      // Small delay to let tab render if newly created
      requestAnimationFrame(() => {
        const el = document.getElementById(`diff-${filePath}`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
    window.addEventListener('diff:scrollToFile', handler)
    return () => window.removeEventListener('diff:scrollToFile', handler)
  }, [])

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

  if (loading) {
    return (
      <div className={styles.diffViewerContainer}>
        <div className={styles.diffEmpty}>
          <span className={styles.diffEmptyText}>Loading changes...</span>
        </div>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className={styles.diffViewerContainer}>
        <div className={styles.diffEmpty}>
          <span className={styles.diffEmptyIcon}>&#10003;</span>
          <span className={styles.diffEmptyText}>No changes</span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.diffViewerContainer}>
      {/* Toolbar */}
      <div className={styles.diffToolbar}>
        <span className={styles.diffFileCount}>
          {commitHash
            ? `${commitHash.slice(0, 7)} ${commitMessage || ''}`
            : `${files.length} changed file${files.length !== 1 ? 's' : ''}`
          }
        </span>
        <div className={styles.diffToggle}>
          <button
            className={`${styles.diffToggleOption} ${!inline ? styles.active : ''}`}
            onClick={() => updateSettings({ diffInline: false })}
          >
            Side by side
          </button>
          <button
            className={`${styles.diffToggleOption} ${inline ? styles.active : ''}`}
            onClick={() => updateSettings({ diffInline: true })}
          >
            Inline
          </button>
        </div>
      </div>

      <p className={styles.diffCommentHint}>
        Hover a line and click + to comment, or drag across line numbers for a range.
      </p>

      {/* File strip */}
      <FileStrip files={files} activeFile={activeFile} />

      {/* Stacked diffs */}
      <div ref={scrollAreaRef} className={styles.diffScrollArea}>
        {files.map((f) => (
          <DiffFileSection
            key={f.filePath}
            data={f}
            inline={inline}
            worktreePath={worktreePath}
            onOpenFile={openFileFromDiff}
            worktreeAnnotations={annotations}
            onAnnotationsChanged={loadAnnotations}
            showPatchAnchorNote={!!commitHash}
            enableAcceptReject
          />
        ))}
      </div>
    </div>
  )
}
