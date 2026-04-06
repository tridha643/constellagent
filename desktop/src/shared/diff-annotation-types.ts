/**
 * Shape for inline diff review notes in the UI. Backed by libSQL review annotations
 * (via `@tridha643/review-annotations`); this file only defines shared TypeScript types.
 */

/** Matches @pierre/diffs AnnotationSide */
export type DiffAnnotationSide = 'additions' | 'deletions'

export interface DiffAnnotation {
  id: string
  /** Repo-relative path (same as git status / DiffFileData.filePath) */
  filePath: string
  side: DiffAnnotationSide
  /** First line of the comment range (inclusive), as shown in the diff gutter for `side`. */
  lineNumber: number
  /** Last line of the range (inclusive). Omit when the comment is a single line. */
  lineEnd?: number
  body: string
  createdAt: string
  resolved: boolean
  /** Set by coding agents (e.g. "constellagent"). Absent for human-authored comments. */
  author?: string
}

export type DiffAnnotationAddInput = Pick<DiffAnnotation, 'filePath' | 'side' | 'lineNumber' | 'body'> & {
  lineEnd?: number
}

/** Inclusive end line for display / agents (defaults to lineNumber). */
export function annotationLineEnd(a: Pick<DiffAnnotation, 'lineNumber' | 'lineEnd'>): number {
  const end = a.lineEnd
  return end != null && Number.isFinite(end) ? end : a.lineNumber
}
