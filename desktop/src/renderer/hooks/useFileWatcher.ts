import { useEffect } from 'react'
import { isPerfDebugEnabled, logPerfEvent } from '../utils/perf'

const activeWatcherPaths = new Set<string>()

/**
 * Watch a directory for filesystem changes and invoke a callback when changes occur.
 * Handles watchDir registration, onDirChanged listener filtered by path, and cleanup.
 */
export function useFileWatcher(worktreePath: string, callback: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    activeWatcherPaths.add(worktreePath)
    if (isPerfDebugEnabled()) {
      logPerfEvent('fs:watcher-count', 100, {
        worktreePath,
        watcherCount: activeWatcherPaths.size,
      })
    }
    window.api.fs.watchDir(worktreePath)
    const unsub = window.api.fs.onDirChanged((changedDir: string) => {
      if (changedDir === worktreePath) callback()
    })
    return () => {
      activeWatcherPaths.delete(worktreePath)
      unsub()
      window.api.fs.unwatchDir(worktreePath)
    }
  }, [worktreePath, callback, enabled])
}
