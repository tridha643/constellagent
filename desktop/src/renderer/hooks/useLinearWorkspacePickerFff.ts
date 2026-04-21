import { useEffect, useState } from 'react'
import {
  fuzzyMatchSubsequence,
  linearFffIndexSyncHash,
} from '../linear/linear-jump-index'

const DEBOUNCE_MS = 80
const FFF_LIMIT = 500
const WORKSPACE_PICKER_INDEX_KEY = 'workspace-picker-global'

export interface LinearWorkspacePickerRow {
  id: string
  title: string
  subtitle: string
  searchBlob: string
  fffRelativePath: string
  targetWorkspaceId?: string
  kind?: 'workspace' | 'project' | 'stack-branch'
}

function fallbackFilterRows(
  rows: LinearWorkspacePickerRow[],
  query: string,
): LinearWorkspacePickerRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows

  const scored: { row: LinearWorkspacePickerRow; score: number }[] = []
  for (const row of rows) {
    const indices = fuzzyMatchSubsequence(q, row.searchBlob)
    if (!indices || indices.length === 0) continue

    let gapPenalty = 0
    for (let i = 1; i < indices.length; i += 1) {
      gapPenalty += Math.max(0, indices[i]! - indices[i - 1]! - 1)
    }

    const first = indices[0] ?? 0
    const compactness = indices.length > 1 ? indices[indices.length - 1]! - first : 0
    const score =
      indices.length * 1000
      - first * 8
      - gapPenalty * 14
      - compactness * 3
      - row.searchBlob.length * 0.05

    scored.push({ row, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title))
    .map((entry) => entry.row)
}

export function useLinearWorkspacePickerFff(
  rows: LinearWorkspacePickerRow[],
  query: string,
): LinearWorkspacePickerRow[] {
  const [filtered, setFiltered] = useState(rows)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setFiltered(rows)
      return
    }

    const entries = rows.map((row) => ({ relativePath: row.fffRelativePath }))
    if (entries.length === 0) {
      setFiltered([])
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const syncHash = linearFffIndexSyncHash(entries)
        try {
          const res = await window.api.linearFffQuickOpen({
            indexKey: WORKSPACE_PICKER_INDEX_KEY,
            syncHash,
            entries,
            query: q,
            limit: FFF_LIMIT,
          })
          if (cancelled) return

          if (res.state === 'error' || res.error) {
            setFiltered(fallbackFilterRows(rows, q))
            return
          }

          const byPath = new Map(rows.map((row) => [row.fffRelativePath, row] as const))
          const ordered = (res.relativePaths ?? [])
            .map((path) => byPath.get(path))
            .filter((row): row is LinearWorkspacePickerRow => Boolean(row))

          setFiltered(ordered.length > 0 ? ordered : fallbackFilterRows(rows, q))
        } catch {
          if (!cancelled) setFiltered(fallbackFilterRows(rows, q))
        }
      })()
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [rows, query])

  return filtered
}
