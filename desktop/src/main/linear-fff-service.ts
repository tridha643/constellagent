import { mkdir, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { app } from 'electron'
import type { FileFinder as FileFinderType } from '@ff-labs/fff-node'
import type { LinearFffQuickOpenRequest, LinearFffQuickOpenResult } from '../shared/linear-fff-types'

function fffScoreTotal(score: { total?: number } | undefined): number {
  return score?.total ?? 0
}

type FffNodeModule = typeof import('@ff-labs/fff-node')
let fffNodeModulePromise: Promise<FffNodeModule> | null = null

function loadFffNodeModule(): Promise<FffNodeModule> {
  if (!fffNodeModulePromise) {
    fffNodeModulePromise = import('@ff-labs/fff-node')
  }
  return fffNodeModulePromise
}

interface FinderState {
  finder: FileFinderType
  ready: Promise<void>
}

const MAX_STUB_FILES = 4000

export class LinearFffService {
  private static finders = new Map<string, Promise<FinderState>>()
  private static lastSyncHash = new Map<string, string>()
  private static searchMutex = Promise.resolve()

  private static getIndexRoot(indexKey: string): string {
    const safe = indexKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'default'
    return join(app.getPath('userData'), 'linear-fff-index', safe)
  }

  private static async ensureFinder(indexRoot: string): Promise<FinderState> {
    const existing = this.finders.get(indexRoot)
    if (existing) return existing

    const created = (async (): Promise<FinderState> => {
      const { FileFinder } = await loadFffNodeModule()
      if (!FileFinder.isAvailable()) {
        throw new Error('fff binary is not available on this machine')
      }
      FileFinder.ensureLoaded()
      const result = FileFinder.create({
        basePath: indexRoot,
        aiMode: true,
        disableWatch: true,
        disableMmapCache: true,
        disableContentIndexing: true,
      })
      if (!result.ok) {
        throw new Error(`Failed to initialize Linear fff index: ${result.error}`)
      }
      const finder = result.value
      const ready = finder.waitForScan(15_000).then((waited) => {
        if (!waited.ok) throw new Error(waited.error)
      })
      return { finder, ready }
    })().catch((err) => {
      this.finders.delete(indexRoot)
      throw err
    })

    this.finders.set(indexRoot, created)
    return created
  }

  private static async destroyFinder(indexRoot: string): Promise<void> {
    const p = this.finders.get(indexRoot)
    this.finders.delete(indexRoot)
    if (!p) return
    try {
      const { finder } = await p
      finder.destroy()
    } catch {
      /* ignore */
    }
  }

  /** Rewrite synthetic tree and recreate FileFinder when syncHash changes. */
  private static async syncTree(indexRoot: string, entries: { relativePath: string }[]): Promise<void> {
    await this.destroyFinder(indexRoot)
    await rm(indexRoot, { recursive: true, force: true })
    await mkdir(indexRoot, { recursive: true })

    const capped = entries.slice(0, MAX_STUB_FILES)
    for (const e of capped) {
      const rel = e.relativePath.replace(/\\/g, '/')
      if (!rel || rel.includes('..')) continue
      const full = join(indexRoot, rel)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, '')
    }
  }

  static async quickOpenSearch(request: LinearFffQuickOpenRequest): Promise<LinearFffQuickOpenResult> {
    return this.runExclusive(async () => this.quickOpenSearchImpl(request))
  }

  private static async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.searchMutex.then(fn, fn)
    this.searchMutex = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private static async quickOpenSearchImpl(request: LinearFffQuickOpenRequest): Promise<LinearFffQuickOpenResult> {
    const indexKey = request.indexKey?.trim() || 'default'
    const indexRoot = this.getIndexRoot(indexKey)
    const query = request.query ?? ''
    const limit = Math.max(1, Math.min(request.limit ?? LINEAR_JUMP_RESULT_LIMIT, 200))
    const entries = request.entries ?? []

    if (!query.trim()) {
      return { state: 'ready', relativePaths: [], scores: [] }
    }

    try {
      const { FileFinder } = await loadFffNodeModule()
      if (!FileFinder.isAvailable()) {
        return { state: 'error', relativePaths: [], error: 'fff binary is not available on this machine' }
      }

      if (entries.length === 0) {
        return { state: 'ready', relativePaths: [], scores: [] }
      }

      const prevHash = this.lastSyncHash.get(indexRoot)
      if (prevHash !== request.syncHash) {
        await this.syncTree(indexRoot, entries)
        this.lastSyncHash.set(indexRoot, request.syncHash)
      }

      const { finder, ready } = await this.ensureFinder(indexRoot)
      const progress = finder.getScanProgress()
      if (progress.ok && progress.value.isScanning) {
        await Promise.race([ready, new Promise<void>((r) => setTimeout(r, 400))])
      }

      const search = finder.fileSearch(query, { pageSize: limit })
      if (!search.ok) {
        return { state: 'error', relativePaths: [], error: search.error }
      }

      const slice = search.value.items.slice(0, limit)
      const paths = slice.map((it) => it.relativePath.replace(/\\/g, '/'))
      const scores = slice.map((_, i) =>
        fffScoreTotal(search.value.scores[i]),
      )
      const nextProgress = finder.getScanProgress()
      return {
        state: nextProgress.ok && nextProgress.value.isScanning ? 'indexing' : 'ready',
        relativePaths: paths,
        scores,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Linear fff search failed'
      return { state: 'error', relativePaths: [], error: msg }
    }
  }

  static disposeAll(): void {
    const roots = [...this.finders.keys()]
    for (const r of roots) {
      void this.destroyFinder(r)
    }
    this.finders.clear()
    this.lastSyncHash.clear()
  }
}

/** Keep in sync with renderer LINEAR_JUMP_RESULT_LIMIT */
const LINEAR_JUMP_RESULT_LIMIT = 50
