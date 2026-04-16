export interface QuickOpenSearchItem {
  path: string
  relativePath: string
  fileName: string
  gitStatus?: string
  score: number
  matchType?: string
  exactMatch?: boolean
}

export interface QuickOpenSearchRequest {
  query: string
  limit?: number
  currentFile?: string
}

export interface QuickOpenSearchResult {
  state: 'ready' | 'indexing' | 'error'
  items: QuickOpenSearchItem[]
  totalMatched: number
  totalFiles: number
  error?: string
}
