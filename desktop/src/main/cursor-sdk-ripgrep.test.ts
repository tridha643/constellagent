import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureCursorSdkRipgrep, resolveRipgrepPath } from './cursor-sdk-ripgrep'

describe('cursor-sdk-ripgrep', () => {
  const prev = process.env.CURSOR_RIPGREP_PATH

  afterEach(() => {
    if (prev === undefined) delete process.env.CURSOR_RIPGREP_PATH
    else process.env.CURSOR_RIPGREP_PATH = prev
  })

  it('resolveRipgrepPath honors CURSOR_RIPGREP_PATH when the file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rg-path-'))
    const rg = join(dir, 'rg')
    writeFileSync(rg, '#!/bin/sh\n', { mode: 0o755 })
    process.env.CURSOR_RIPGREP_PATH = rg
    expect(resolveRipgrepPath()).toBe(rg)
  })

  it('configureCursorSdkRipgrep sets CURSOR_RIPGREP_PATH from an existing env path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rg-config-'))
    const rg = join(dir, 'rg')
    writeFileSync(rg, '#!/bin/sh\n', { mode: 0o755 })
    process.env.CURSOR_RIPGREP_PATH = rg
    configureCursorSdkRipgrep()
    expect(process.env.CURSOR_RIPGREP_PATH).toBe(rg)
  })
})
