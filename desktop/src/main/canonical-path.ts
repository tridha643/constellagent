import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Canonicalize a filesystem path for stable identity comparison.
 *
 * Uses `realpathSync` so symlinks (e.g. macOS `/var` → `/private/var`) and
 * `.`/`..` segments collapse to one canonical form, which is what callers rely
 * on when keying maps or deduping worktree/repo paths. For paths that do not
 * exist yet (or that `realpathSync` rejects on a race/permission error) it
 * falls back to `resolve`, which still produces an absolute, lexically-normal
 * path.
 *
 * This was previously copy-pasted verbatim as `normalizePath` /
 * `normalizeRepoKey` in persisted-state, worktree-sync-service, and
 * project-startup-settings; keep the single source of truth here so the
 * comparison semantics stay identical across the main process.
 */
export function canonicalizePath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}
