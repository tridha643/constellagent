import type { DiffAnnotation, DiffAnnotationSide } from '@shared/diff-annotation-types'
import { annotationLineEnd } from '@shared/diff-annotation-types'

/**
 * Adapter: our flat `DiffAnnotation[]` → rudu-shaped `FileReviewThreads`.
 *
 * Co-located comments (same `side` + anchor `lineNumber`) collapse into one
 * `ReviewThread` whose `comments[]` mixes every source — local-human, AI-agent,
 * and GitHub-PR-reviewer — so a line renders "see other reviewers" together.
 * We have no reply graph, so the thread id is derived from the anchor, not a
 * synthetic reply chain.
 */

export type ReviewerKind = 'local-human' | 'ai-agent' | 'github'

export interface ReviewThread {
  /** Stable id from the anchor: `${side}:${lineNumber}`. */
  id: string
  side: DiffAnnotationSide
  lineNumber: number
  lineEnd: number
  /** Mixed-source comments at this anchor, oldest-first. */
  comments: DiffAnnotation[]
}

export interface FileReviewThreads {
  filePath: string
  normalizedPath: string
  threads: ReviewThread[]
  /** Keyed by `${side}:${lineNumber}` for O(1) annotation-slot lookup. */
  byAnchor: Map<string, ReviewThread>
}

export type ReviewThreadsByFile = ReadonlyMap<string, FileReviewThreads>

/** GitHub PR review/issue comments carry GraphQL node-id prefixes. */
export function isGithubAnnotation(annotation: Pick<DiffAnnotation, 'id'>): boolean {
  return annotation.id.startsWith('PRR') || annotation.id.startsWith('IC_')
}

export function classifyReviewer(annotation: DiffAnnotation): ReviewerKind {
  if (isGithubAnnotation(annotation)) return 'github'
  if (annotation.author) return 'ai-agent'
  return 'local-human'
}

/** Local-human comments are the only ones selectable for Cmd+Shift+R submission. */
export function isSelectableHumanComment(annotation: DiffAnnotation): boolean {
  return classifyReviewer(annotation) === 'local-human'
}

/** Normalize a repo-relative path for stable cross-source keying. */
export function normalizePath(filePath: string): string {
  let p = filePath.trim()
  while (p.startsWith('./')) p = p.slice(2)
  if (p.startsWith('/')) p = p.replace(/^\/+/, '')
  return p
}

function anchorKey(side: DiffAnnotationSide, lineNumber: number): string {
  return `${side}:${lineNumber}`
}

export function buildReviewThreadsByFile(annotations: readonly DiffAnnotation[]): ReviewThreadsByFile {
  const byFile = new Map<string, FileReviewThreads>()

  for (const annotation of annotations) {
    const normalizedPath = normalizePath(annotation.filePath)
    let fileThreads = byFile.get(normalizedPath)
    if (!fileThreads) {
      fileThreads = { filePath: annotation.filePath, normalizedPath, threads: [], byAnchor: new Map() }
      byFile.set(normalizedPath, fileThreads)
    }
    const key = anchorKey(annotation.side, annotation.lineNumber)
    let thread = fileThreads.byAnchor.get(key)
    if (!thread) {
      thread = {
        id: key,
        side: annotation.side,
        lineNumber: annotation.lineNumber,
        lineEnd: annotationLineEnd(annotation),
        comments: [],
      }
      fileThreads.byAnchor.set(key, thread)
      fileThreads.threads.push(thread)
    }
    thread.comments.push(annotation)
    thread.lineEnd = Math.max(thread.lineEnd, annotationLineEnd(annotation))
  }

  // Oldest-first within each thread so stacked cards read top-to-bottom.
  for (const fileThreads of byFile.values()) {
    for (const thread of fileThreads.threads) {
      thread.comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    }
  }

  return byFile
}

export function getFileReviewThreadsForPath(
  byFile: ReviewThreadsByFile,
  filePath: string,
): FileReviewThreads | undefined {
  return byFile.get(normalizePath(filePath))
}
