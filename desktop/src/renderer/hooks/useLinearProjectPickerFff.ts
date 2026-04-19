import { useEffect, useState } from 'react'
import type { LinearProjectNode } from '../linear/linear-api'
import {
  filterAndSortJumpRows,
  linearFffIndexSyncHash,
  linearJumpRowsFromSearchProjects,
  linearJumpRowsToFffIndexEntries,
  linearProjectPickerFffIndexKey,
  rankJumpRowsFromFffPaths,
  type LinearJumpRow,
} from '../linear/linear-jump-index'

const DEBOUNCE_MS = 80
const FFF_LIMIT = 500

function projectNodesFromPickerRows(
  rows: LinearJumpRow[],
  byId: Map<string, LinearProjectNode>,
): LinearProjectNode[] {
  const out: LinearProjectNode[] = []
  for (const r of rows) {
    if (r.kind !== 'project' || !r.projectId) continue
    const p = byId.get(r.projectId)
    if (p) out.push(p)
  }
  return out
}

function fallbackFilterProjects(projects: LinearProjectNode[], query: string): LinearProjectNode[] {
  const rows = linearJumpRowsFromSearchProjects(projects)
  const ranked = filterAndSortJumpRows(rows, query, FFF_LIMIT)
  const byId = new Map(projects.map((p) => [p.id, p]))
  return projectNodesFromPickerRows(ranked, byId)
}

/**
 * Filter/rank projects in the Tickets/Updates project popover using the same native fff
 * pipeline as Linear Quick Open (synthetic paths + main-process FileFinder).
 */
export function useLinearProjectPickerFff(
  projects: LinearProjectNode[],
  query: string,
  apiKey: string,
): LinearProjectNode[] {
  const [filtered, setFiltered] = useState<LinearProjectNode[]>(projects)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setFiltered(projects)
      return
    }

    const key = apiKey.trim()
    if (!key) {
      setFiltered(fallbackFilterProjects(projects, q))
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const rows = linearJumpRowsFromSearchProjects(projects)
        const entries = linearJumpRowsToFffIndexEntries(rows)
        const byId = new Map(projects.map((p) => [p.id, p]))

        if (entries.length === 0) {
          if (!cancelled) setFiltered([])
          return
        }

        const syncHash = linearFffIndexSyncHash(entries)
        try {
          const res = await window.api.linearFffQuickOpen({
            indexKey: linearProjectPickerFffIndexKey(key),
            syncHash,
            entries,
            query: q,
            limit: FFF_LIMIT,
          })
          if (cancelled) return

          if (res.state === 'error' || res.error) {
            setFiltered(fallbackFilterProjects(projects, q))
            return
          }

          const paths = res.relativePaths ?? []
          if (paths.length === 0) {
            setFiltered([])
            return
          }

          const byPath = new Map<string, LinearJumpRow>(
            rows.filter((r) => r.fffRelativePath).map((r) => [r.fffRelativePath!, r] as const),
          )
          const ordered = rankJumpRowsFromFffPaths(paths, res.scores, byPath)
          const next = projectNodesFromPickerRows(ordered, byId)
          setFiltered(
            next.length > 0 ? next : fallbackFilterProjects(projects, q),
          )
        } catch {
          if (!cancelled) setFiltered(fallbackFilterProjects(projects, q))
        }
      })()
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [projects, query, apiKey])

  return filtered
}
