export type CodeSearchMode = 'plain' | 'regex'

export type CodeSearchScope =
  | { kind: 'workspace' }
  | { kind: 'activeFile'; filePath: string }
  | { kind: 'changeSet'; filePaths: string[] }

export interface CodeSearchRequest {
  query: string
  scope?: CodeSearchScope
  mode?: CodeSearchMode
  limit?: number
  maxMatchesPerFile?: number
  maxFileSizeBytes?: number
}

export interface CodeSearchItem {
  path: string
  relativePath: string
  fileName: string
  gitStatus?: string
  lineNumber: number
  column: number
  preview: string
  matchRanges?: Array<[number, number]>
  previewTruncated?: boolean
}

export interface CodeSearchResult {
  state: 'ready' | 'indexing' | 'error'
  items: CodeSearchItem[]
  /** Number of matches returned in this response after caps are applied. */
  totalMatched: number
  /** Number of files in the requested scope after developer-file filtering. */
  candidateFileCount: number
  /** Number of files actually searched while producing this response. */
  searchedFileCount: number
  /** True when more matches may exist beyond the returned items. */
  hasMore: boolean
  error?: string
  regexFallbackError?: string
}

export const DEFAULT_CODE_SEARCH_LIMIT = 100
export const MAX_CODE_SEARCH_LIMIT = 200
export const DEFAULT_CODE_SEARCH_MAX_MATCHES_PER_FILE = 10
export const MAX_CODE_SEARCH_MAX_MATCHES_PER_FILE = 25
export const DEFAULT_CODE_SEARCH_MAX_FILE_SIZE_BYTES = 1_000_000
export const MAX_CODE_SEARCH_MAX_FILE_SIZE_BYTES = 2_000_000
export const DEFAULT_CODE_SEARCH_PREVIEW_CHARS = 220
