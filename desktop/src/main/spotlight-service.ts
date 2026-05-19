import { watch, type FSWatcher } from 'fs'
import { existsSync } from 'fs'
import { IPC } from '../shared/ipc-channels'
import type { SpotlightMode, SpotlightState, SpotlightStatus } from '../shared/spotlight-types'
import { GitService, type SpotlightRootSnapshot } from './git-service'

interface ProjectEntry {
  projectId: string
  workspaceId: string
  worktreePath: string
  rootPath: string
  watcher: FSWatcher | null
  debounceTimer: NodeJS.Timeout | null
  snapshot: SpotlightRootSnapshot | null
  state: SpotlightState
  mode: SpotlightMode
  lastSyncAt: number | null
  message: string | undefined
  /** Single-flight guard so concurrent file events don't race the worker. */
  syncInFlight: boolean
  /** Set when a change arrived mid-sync; triggers one more cycle after the current one. */
  resyncPending: boolean
  /** Disposed entries refuse further work (covers race between disable() and an in-flight debounce). */
  disposed: boolean
}

interface EnableOptions {
  projectId: string
  workspaceId: string
  worktreePath: string
  rootPath: string
}

const DEBOUNCE_MS = 500

/**
 * Single-flight, per-project worker that owns the workspace → repo-root one-way
 * sync described in the Spotlight plan. Pattern mirrors `WorktreeSyncService`:
 * one entry per project, state broadcast via `IPC.SPOTLIGHT_STATUS` so the
 * renderer can drive the sidebar dot + toasts off the same shape.
 */
export class SpotlightService {
  private entries = new Map<string, ProjectEntry>()

  /** Engage Spotlight for `workspaceId` in `projectId`. Quietly transfers if
   * a different workspace in the same project is currently spotlighted. */
  async enable(opts: EnableOptions): Promise<SpotlightStatus> {
    const existing = this.entries.get(opts.projectId)
    if (existing && existing.workspaceId !== opts.workspaceId) {
      // Per-project invariant: at most one spotlight active. Transfer.
      await this.disable(opts.projectId)
    } else if (existing && existing.workspaceId === opts.workspaceId) {
      // Already engaged; surface current status.
      return this.statusOf(existing)
    }

    const entry: ProjectEntry = {
      projectId: opts.projectId,
      workspaceId: opts.workspaceId,
      worktreePath: opts.worktreePath,
      rootPath: opts.rootPath,
      watcher: null,
      debounceTimer: null,
      snapshot: null,
      state: 'preparing',
      mode: 'fast',
      lastSyncAt: null,
      message: undefined,
      syncInFlight: false,
      resyncPending: false,
      disposed: false,
    }
    this.entries.set(opts.projectId, entry)
    this.broadcast(entry)

    try {
      if (
        (await GitService.hasRebaseOrMergeInProgress(opts.worktreePath)) ||
        (await GitService.hasRebaseOrMergeInProgress(opts.rootPath))
      ) {
        this.markBlocked(entry, 'Finish or abort the rebase/merge first.')
        return this.statusOf(entry)
      }

      entry.mode = (await GitService.hasSubmodules(opts.worktreePath)) ? 'safe-submodules' : 'fast'
      entry.snapshot = await GitService.snapshotForSpotlight(opts.rootPath)
      await this.runSync(entry)
      if (entry.state !== 'error' && entry.state !== 'blocked') {
        this.attachWatcher(entry)
        entry.state = 'watching'
        this.broadcast(entry)
      }
    } catch (err) {
      this.markError(entry, err instanceof Error ? err.message : 'Failed to enable Spotlight')
    }
    return this.statusOf(entry)
  }

  /** Stop watching, restore root to its pre-spotlight state, delete the ref. */
  async disable(projectId: string): Promise<void> {
    const entry = this.entries.get(projectId)
    if (!entry) return
    entry.disposed = true
    if (entry.watcher) {
      try { entry.watcher.close() } catch {}
      entry.watcher = null
    }
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer)
      entry.debounceTimer = null
    }
    entry.state = 'restoring'
    this.broadcast(entry)

    try {
      if (entry.snapshot) {
        await GitService.restoreSpotlightSnapshot(entry.rootPath, entry.snapshot)
      }
      await GitService.deleteSpotlightRef(entry.worktreePath, entry.workspaceId)
    } catch (err) {
      // Mirror Conductor: surface the error but still drop the entry so the UI
      // doesn't get stuck claiming to spotlight a workspace it isn't watching.
      this.broadcast({ ...entry, state: 'error', message: err instanceof Error ? err.message : 'Restore failed' })
    }
    this.entries.delete(projectId)
    // Final idle status with null workspaceId so renderer clears the dot/ring.
    this.broadcastRaw({
      projectId,
      workspaceId: null,
      state: 'idle',
    })
  }

  getStatus(projectId?: string): SpotlightStatus[] {
    if (projectId) {
      const e = this.entries.get(projectId)
      return e ? [this.statusOf(e)] : []
    }
    return [...this.entries.values()].map((e) => this.statusOf(e))
  }

  /**
   * After app start, re-arm watchers for projects whose spotlight survived a
   * restart. If the worktree's `write-tree` differs from root's `HEAD^{tree}`
   * the sync runs once and `onDrift` fires so the renderer can show a toast.
   */
  async restoreOnStartup(
    persisted: Array<{ projectId: string; workspaceId: string; worktreePath: string; rootPath: string }>,
    onDrift?: (info: { projectId: string; workspaceId: string }) => void,
    onMissing?: (info: { projectId: string; workspaceId: string }) => void,
  ): Promise<void> {
    for (const p of persisted) {
      if (!existsSync(p.worktreePath) || !existsSync(p.rootPath)) {
        onMissing?.({ projectId: p.projectId, workspaceId: p.workspaceId })
        continue
      }
      try {
        const status = await this.enable(p)
        if (status.state === 'watching' && status.lastSyncAt) {
          // enable() always syncs once; "drift" is approximated by whether the
          // pre-existing root tree matched. Cheap to re-emit on every restore.
          onDrift?.({ projectId: p.projectId, workspaceId: p.workspaceId })
        }
      } catch {
        onMissing?.({ projectId: p.projectId, workspaceId: p.workspaceId })
      }
    }
  }

  stopAll(): void {
    for (const projectId of [...this.entries.keys()]) {
      void this.disable(projectId)
    }
  }

  // ── internals ─────────────────────────────────────────────────────────

  private attachWatcher(entry: ProjectEntry): void {
    try {
      entry.watcher = watch(entry.worktreePath, { recursive: true }, (_eventType, filename) => {
        if (entry.disposed) return
        const f = (filename ?? '').toString().replaceAll('\\', '/')
        // Skip git internals; mirror the same allowlist used by the global FS
        // watcher in ipc.ts. Otherwise every transient lock under `.git/` would
        // re-trigger sync forever.
        if (f.startsWith('.git/')) {
          const isStateChange = f === '.git/index' || f === '.git/HEAD' || f.startsWith('.git/refs/')
          if (!isStateChange) return
        }
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
        entry.debounceTimer = setTimeout(() => {
          entry.debounceTimer = null
          void this.runSync(entry)
        }, DEBOUNCE_MS)
      })
    } catch (err) {
      this.markError(entry, err instanceof Error ? err.message : 'Failed to watch worktree')
    }
  }

  private async runSync(entry: ProjectEntry): Promise<void> {
    if (entry.disposed) return
    if (entry.syncInFlight) {
      entry.resyncPending = true
      return
    }
    entry.syncInFlight = true
    entry.state = 'syncing'
    this.broadcast(entry)

    try {
      if (
        (await GitService.hasRebaseOrMergeInProgress(entry.worktreePath)) ||
        (await GitService.hasRebaseOrMergeInProgress(entry.rootPath))
      ) {
        this.markBlocked(entry, 'Finish or abort the rebase/merge first.')
        return
      }

      const commitSha = await GitService.commitToSpotlightRef(entry.worktreePath, entry.workspaceId)
      if (entry.mode === 'safe-submodules') {
        await GitService.applyTreeViaArchive(entry.rootPath, commitSha)
      } else {
        await GitService.readTreeInto(entry.rootPath, commitSha)
      }
      entry.lastSyncAt = Date.now()
      entry.message = undefined
      entry.state = 'watching'
      this.broadcast(entry)
    } catch (err) {
      this.markError(entry, err instanceof Error ? err.message : 'Sync failed')
    } finally {
      entry.syncInFlight = false
      if (entry.resyncPending && !entry.disposed) {
        entry.resyncPending = false
        void this.runSync(entry)
      }
    }
  }

  private markBlocked(entry: ProjectEntry, msg: string): void {
    entry.state = 'blocked'
    entry.message = msg
    this.broadcast(entry)
  }

  private markError(entry: ProjectEntry, msg: string): void {
    entry.state = 'error'
    entry.message = msg
    this.broadcast(entry)
  }

  private statusOf(entry: ProjectEntry): SpotlightStatus {
    return {
      projectId: entry.projectId,
      workspaceId: entry.workspaceId,
      state: entry.state,
      mode: entry.mode,
      lastSyncAt: entry.lastSyncAt ?? undefined,
      message: entry.message,
    }
  }

  private broadcast(entry: ProjectEntry): void {
    this.broadcastRaw(this.statusOf(entry))
  }

  private broadcastRaw(status: SpotlightStatus): void {
    // Lazy-require Electron so unit tests can run without it. The service is
    // otherwise free of `electron` imports.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { BrowserWindow } = require('electron') as typeof import('electron')
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC.SPOTLIGHT_STATUS, status)
      }
    } catch {
      // No electron in unit test context — broadcast is a no-op.
    }
  }
}
