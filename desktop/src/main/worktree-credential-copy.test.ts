import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { copyWorktreeCredentialArtifacts } from './worktree-credential-copy'

const isWin = process.platform === 'win32'

let workRoot: string
let sourceRoot: string
let destRoot: string

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'wt-cred-copy-'))
  sourceRoot = join(workRoot, 'source')
  destRoot = join(workRoot, 'dest')
  mkdirSync(sourceRoot, { recursive: true })
  mkdirSync(destRoot, { recursive: true })
})

afterEach(() => {
  try {
    rmSync(workRoot, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

describe('copyWorktreeCredentialArtifacts', () => {
  it('copies a regular .env file (fast path)', async () => {
    writeFileSync(join(sourceRoot, '.env'), 'KEY=plain\n')

    await copyWorktreeCredentialArtifacts(sourceRoot, destRoot)

    const destPath = join(destRoot, '.env')
    expect(existsSync(destPath)).toBe(true)
    const buf = readFileSync(destPath, 'utf8')
    expect(buf).toBe('KEY=plain\n')
  })

  it.skipIf(isWin)('snapshots a FIFO .env into a regular file', async () => {
    const fifoPath = join(sourceRoot, '.env')
    execSync(`mkfifo "${fifoPath}"`)

    const writerTimer = setTimeout(() => {
      // Write asynchronously; the reader stream will open the FIFO for read.
      writeFile(fifoPath, 'KEY=val\n').catch(() => {})
    }, 50)

    try {
      await copyWorktreeCredentialArtifacts(sourceRoot, destRoot, undefined, {
        envCaptureTimeoutMs: 5000,
      })
    } finally {
      clearTimeout(writerTimer)
    }

    const destPath = join(destRoot, '.env')
    expect(existsSync(destPath)).toBe(true)
    const destStat = statSync(destPath)
    expect(destStat.isFile()).toBe(true)
    expect(destStat.isFIFO()).toBe(false)
    expect(readFileSync(destPath, 'utf8')).toBe('KEY=val\n')
  })

  it.skipIf(isWin)('throws on FIFO read timeout', async () => {
    const fifoPath = join(sourceRoot, '.env')
    execSync(`mkfifo "${fifoPath}"`)

    await expect(
      copyWorktreeCredentialArtifacts(sourceRoot, destRoot, undefined, {
        envCaptureTimeoutMs: 200,
      }),
    ).rejects.toThrow(/Failed to copy required worktree credential "\.env"/)

    expect(existsSync(join(destRoot, '.env'))).toBe(false)
  })

  it.skipIf(isWin)('snapshots through a symlink that points to a FIFO', async () => {
    // FIFO lives outside sourceRoot so it isn't itself matched by the rules;
    // only the .env symlink (which resolves to the FIFO) should be processed.
    const fifoPath = join(workRoot, 'external.fifo')
    execSync(`mkfifo "${fifoPath}"`)
    symlinkSync(fifoPath, join(sourceRoot, '.env'))

    const writerTimer = setTimeout(() => {
      writeFile(fifoPath, 'LINKED=ok\n').catch(() => {})
    }, 50)

    try {
      await copyWorktreeCredentialArtifacts(sourceRoot, destRoot, undefined, {
        envCaptureTimeoutMs: 5000,
      })
    } finally {
      clearTimeout(writerTimer)
    }

    const destPath = join(destRoot, '.env')
    expect(existsSync(destPath)).toBe(true)
    const destStat = statSync(destPath)
    expect(destStat.isFile()).toBe(true)
    expect(destStat.isSymbolicLink()).toBe(false)
    expect(readFileSync(destPath, 'utf8')).toBe('LINKED=ok\n')
  })

  it('does not throw or write when source has no matching files', async () => {
    await copyWorktreeCredentialArtifacts(sourceRoot, destRoot)
    expect(existsSync(join(destRoot, '.env'))).toBe(false)
  })
})
