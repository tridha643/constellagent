/** Linear Cmd+F native fff index — IPC payload (main writes synthetic tree + FileFinder.fileSearch). */

export interface LinearFffIndexEntry {
  relativePath: string
}

export interface LinearFffQuickOpenRequest {
  /** Isolate index directory under userData (e.g. hash of api key prefix). */
  indexKey: string
  /** Skip rewriting disk when unchanged (sorted relative paths). */
  syncHash: string
  entries: LinearFffIndexEntry[]
  query: string
  limit?: number
}

export interface LinearFffQuickOpenResult {
  state: 'ready' | 'indexing' | 'error'
  /** Same order as fff match ranking; map back to row ids in renderer. */
  relativePaths: string[]
  /** Parallel to `relativePaths`: fff match score totals (higher = stronger match). */
  scores?: number[]
  error?: string
}
