export interface HunkComment {
  id: string
  file: string
  newLine?: number
  oldLine?: number
  summary: string
  rationale?: string
  author?: string
}

export interface HunkSessionInfo {
  id: string
  path: string
  repo: string
  source?: string
}

export interface HunkSessionContext {
  file?: string
  hunk?: number
  newLine?: number
  oldLine?: number
}
