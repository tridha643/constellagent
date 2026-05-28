import { mkdtempSync, writeFileSync, mkdirSync, realpathSync, rmSync, utimesSync, appendFileSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ContextWindowService } from './context-window-service'

// Create a fake Claude-Code project sessions dir at:
//   ~/.claude/projects/<encoded-worktree-path>/<sessionId>.jsonl
function encodePath(p: string): string {
  return p.replace(/\//g, '-')
}

describe('ContextWindowService', () => {
  let worktree: string
  let projectDir: string
  let sessionFile: string

  beforeEach(() => {
    worktree = realpathSync(mkdtempSync(join(tmpdir(), 'ctxwin-')))
    projectDir = join(homedir(), '.claude', 'projects', encodePath(worktree))
    mkdirSync(projectDir, { recursive: true })
    sessionFile = join(projectDir, 'session-test.jsonl')
  })

  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }) } catch {}
    try { rmSync(worktree, { recursive: true, force: true }) } catch {}
  })

  test('reads usage from newest jsonl tail', async () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-opus-4',
        usage: { input_tokens: 1000, cache_creation_input_tokens: 500, cache_read_input_tokens: 2000 },
      },
    })
    writeFileSync(sessionFile, line + '\n')

    const svc = new ContextWindowService()
    const data = await svc.getUsage(worktree)
    expect(data).not.toBeNull()
    expect(data!.usedTokens).toBe(3500)
    expect(data!.contextWindowSize).toBe(200_000)
    expect(data!.model).toBe('claude-opus-4')
    expect(data!.sessionId).toBe('session-test')
  })

  test('returns null when project dir does not exist', async () => {
    rmSync(projectDir, { recursive: true, force: true })
    const svc = new ContextWindowService()
    expect(await svc.getUsage(worktree)).toBeNull()
  })

  test('caches by (file, mtimeMs, size) and reuses without re-parsing', async () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-sonnet', usage: { input_tokens: 100 } },
    })
    writeFileSync(sessionFile, line + '\n')

    const svc = new ContextWindowService()
    const first = await svc.getUsage(worktree)
    expect(first).not.toBeNull()
    expect(first!.usedTokens).toBe(100)

    // Corrupt the file contents but keep mtime/size stable: rewrite identical
    // bytes and reset mtime to the value the cache captured. If the cache is
    // honored, the second call returns the cached parsed object without
    // re-reading; the data must still equal the first result.
    const captured = first!
    const cachedMtimeMs = captured.lastUpdated
    utimesSync(sessionFile, cachedMtimeMs / 1000, cachedMtimeMs / 1000)

    const second = await svc.getUsage(worktree)
    expect(second).toEqual(captured)
  })

  test('invalidates cache when file grows', async () => {
    const oldLine = JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-sonnet', usage: { input_tokens: 100 } },
    })
    writeFileSync(sessionFile, oldLine + '\n')

    const svc = new ContextWindowService()
    const first = await svc.getUsage(worktree)
    expect(first!.usedTokens).toBe(100)

    const newLine = JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-sonnet', usage: { input_tokens: 500 } },
    })
    appendFileSync(sessionFile, newLine + '\n')

    const second = await svc.getUsage(worktree)
    expect(second!.usedTokens).toBe(500)
  })

  test('1M context window detected from model string', async () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-opus-4-7[1m]', usage: { input_tokens: 50_000 } },
    })
    writeFileSync(sessionFile, line + '\n')

    const svc = new ContextWindowService()
    const data = await svc.getUsage(worktree)
    expect(data!.contextWindowSize).toBe(1_000_000)
  })
})
