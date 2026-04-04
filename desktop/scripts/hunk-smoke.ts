import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { HunkService } from '../src/main/hunk-service'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`)
}

function pass(label: string): void {
  console.log(`  ✓ ${label}`)
}

async function main(): Promise<void> {
  console.log('[hunk-smoke] checking hunk CLI availability…')
  const available = await HunkService.isAvailable()
  if (!available) {
    console.log('[hunk-smoke] SKIP — hunk CLI not installed (npm i -g hunkdiff)')
    process.exit(0)
  }
  pass('hunk CLI is available')

  const repoPath = await mkdtemp(join(tmpdir(), 'hunk-smoke-'))

  try {
    execSync('git init && git checkout -b main', { cwd: repoPath })
    execSync('git config user.email "smoke@test.com"', { cwd: repoPath })
    execSync('git config user.name "Smoke Test"', { cwd: repoPath })
    await writeFile(join(repoPath, 'hello.txt'), 'original\n')
    execSync('git add . && git commit -m "init"', { cwd: repoPath })
    await writeFile(join(repoPath, 'hello.txt'), 'original\nmodified line\n')

    // ── startSession ──
    console.log('\n[session lifecycle]')
    await HunkService.startSession(repoPath)
    pass('startSession did not throw')

    // ── findSessionForRepo ──
    const session = await HunkService.findSessionForRepo(repoPath)
    assert(session !== null, 'findSessionForRepo returned null after startSession')
    assert(typeof session.id === 'string' && session.id.length > 0, `session.id should be a non-empty string, got: ${JSON.stringify(session.id)}`)
    assert(typeof session.repo === 'string', `session.repo should be a string, got: ${JSON.stringify(session.repo)}`)
    pass(`findSessionForRepo → id=${session.id.slice(0, 8)}…`)

    // ── listSessions ──
    const sessions = await HunkService.listSessions()
    assert(Array.isArray(sessions), `listSessions should return an array, got: ${typeof sessions}`)
    const ours = sessions.find((s) => s.repo === session.repo)
    assert(ours !== undefined, 'our session should appear in listSessions')
    pass(`listSessions → ${sessions.length} session(s)`)

    // ── getContext ──
    const ctx = await HunkService.getContext(repoPath)
    assert(ctx !== null, 'getContext returned null')
    assert(typeof ctx.hunk === 'number' || ctx.hunk === undefined, `context.hunk should be number|undefined, got: ${JSON.stringify(ctx.hunk)}`)
    pass('getContext returned valid context')

    // ── addComment ──
    console.log('\n[comments]')
    await HunkService.addComment(repoPath, 'hello.txt', 1, 'Needs a better name')
    pass('addComment did not throw')

    // ── listComments ──
    const comments = await HunkService.listComments(repoPath)
    assert(Array.isArray(comments), `listComments should return an array, got: ${typeof comments} — ${JSON.stringify(comments).slice(0, 200)}`)
    assert(comments.length === 1, `expected 1 comment, got ${comments.length}`)
    const c = comments[0]
    assert(typeof c.id === 'string' && c.id.length > 0, `comment.id should be non-empty string, got: ${JSON.stringify(c.id)}`)
    assert(c.file === 'hello.txt', `comment.file should be "hello.txt", got: ${JSON.stringify(c.file)}`)
    assert(c.summary === 'Needs a better name', `comment.summary mismatch: ${JSON.stringify(c.summary)}`)
    assert(typeof c.newLine === 'number' || typeof c.oldLine === 'number', `comment should have newLine or oldLine, got: newLine=${c.newLine}, oldLine=${c.oldLine}`)
    pass(`listComments → 1 comment (id=${c.id.slice(0, 12)}…)`)

    // ── listComments with file filter ──
    const filtered = await HunkService.listComments(repoPath, 'hello.txt')
    assert(filtered.length === 1, `filtered listComments should return 1, got ${filtered.length}`)
    const noMatch = await HunkService.listComments(repoPath, 'nonexistent.txt')
    assert(noMatch.length === 0, `listComments for nonexistent file should be empty, got ${noMatch.length}`)
    pass('listComments with file filter works')

    // ── removeComment ──
    await HunkService.removeComment(repoPath, c.id)
    const afterRemove = await HunkService.listComments(repoPath)
    assert(afterRemove.length === 0, `after removeComment, expected 0 comments, got ${afterRemove.length}`)
    pass('removeComment works')

    // ── clearComments ──
    await HunkService.addComment(repoPath, 'hello.txt', 1, 'first')
    await HunkService.addComment(repoPath, 'hello.txt', 1, 'second')
    const beforeClear = await HunkService.listComments(repoPath)
    assert(beforeClear.length === 2, `expected 2 before clear, got ${beforeClear.length}`)
    await HunkService.clearComments(repoPath)
    const afterClear = await HunkService.listComments(repoPath)
    assert(afterClear.length === 0, `after clear, expected 0, got ${afterClear.length}`)
    pass('clearComments works')

    // ── navigate ──
    console.log('\n[navigation]')
    await HunkService.navigate(repoPath, 'hello.txt', { hunk: 1 })
    pass('navigate by hunk did not throw')
    await HunkService.navigate(repoPath, 'hello.txt', { newLine: 1 })
    pass('navigate by newLine did not throw')

    // ── stopSession ──
    console.log('\n[cleanup]')
    await HunkService.stopSession(repoPath)
    pass('stopSession did not throw')

    console.log('\n[hunk-smoke] all passed ✓')
  } finally {
    HunkService.cleanupAll()
    HunkService.resetAvailabilityCache()
    await rm(repoPath, { recursive: true, force: true })
  }
}

await main()
