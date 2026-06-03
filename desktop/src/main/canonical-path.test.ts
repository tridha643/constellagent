import { describe, expect, it } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync, symlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { canonicalizePath } from './canonical-path'

describe('canonicalizePath', () => {
  it('resolves an existing directory to its real (symlink-free) path', () => {
    const base = mkdtempSync(join(realpathSync(tmpdir()), 'canon-'))
    try {
      const real = join(base, 'real')
      const link = join(base, 'link')
      mkdirSync(real)
      symlinkSync(real, link)

      // Both the real path and the symlink must canonicalize to the same value,
      // which is what callers depend on when deduping worktree/repo paths.
      expect(canonicalizePath(link)).toBe(realpathSync(real))
      expect(canonicalizePath(real)).toBe(canonicalizePath(link))
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('falls back to an absolute resolved path when the path does not exist', () => {
    const missing = join(tmpdir(), 'definitely-not-here-9f3c2a', 'child')
    expect(canonicalizePath(missing)).toBe(resolve(missing))
  })

  it('returns identical output for two spellings of the same existing path', () => {
    const base = mkdtempSync(join(realpathSync(tmpdir()), 'canon-'))
    try {
      const nested = join(base, 'a', 'b')
      mkdirSync(nested, { recursive: true })
      const dotted = join(base, 'a', '.', 'b')
      expect(canonicalizePath(dotted)).toBe(canonicalizePath(nested))
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
