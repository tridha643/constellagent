import { constants as fsConstants, existsSync } from 'fs'
import { copyFile, cp, lstat, mkdir, open as fsOpen, readdir, stat, writeFile } from 'fs/promises'
import type { Stats } from 'fs'
import { basename, dirname, join, sep } from 'path'
import { SKIP_DIRS as FILE_SKIP_DIRS } from './file-service'
import {
  normalizeWorktreeCredentialPattern,
  normalizeWorktreeCredentialRules,
  type WorktreeCredentialRule,
} from '../shared/worktree-credentials'

const DEFAULT_ENV_CAPTURE_TIMEOUT_MS = 8000
const MAX_ENV_CAPTURE_BYTES = 5 * 1024 * 1024

class EnvCaptureTimeoutError extends Error {}
class EnvCaptureTooLargeError extends Error {}

const SKIP_DIRS = new Set([
  ...FILE_SKIP_DIRS,
  '.hg',
  '.svn',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  '.tox',
  'out',
])

interface PreparedRule extends WorktreeCredentialRule {
  normalizedPattern: string
  matcher?: RegExp
}

class RequiredCredentialCopyError extends Error {}

function toPosixPath(relativePath: string): string {
  return relativePath.split(sep).join('/')
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function compileGlob(pattern: string): RegExp {
  let regex = '^'

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        regex += '.*'
        i += 1
      } else {
        regex += '[^/]*'
      }
      continue
    }

    if (char === '?') {
      regex += '[^/]'
      continue
    }

    regex += escapeRegExp(char)
  }

  regex += '$'
  return new RegExp(regex)
}

function matchesRule(relativePath: string, isDirectory: boolean, rules: PreparedRule[]): boolean {
  const pathValue = toPosixPath(relativePath)
  const baseName = basename(pathValue)

  for (const rule of rules) {
    if (rule.kind === 'directory' && !isDirectory) continue
    if (rule.kind === 'file' && isDirectory) continue

    if (rule.kind === 'glob') {
      const candidate = rule.normalizedPattern.includes('/') ? pathValue : baseName
      if (rule.matcher?.test(candidate)) return true
      continue
    }

    if (pathValue === rule.normalizedPattern) return true
  }

  return false
}

function isEnvLikePath(relativePath: string): boolean {
  return basename(relativePath).startsWith('.env')
}

interface CopyFileOptions {
  overwrite: boolean
  required: boolean
  envLike: boolean
  relativePath: string
  captureFifoTimeoutMs: number
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function resolveEffectiveStat(
  sourcePath: string,
): Promise<{ stats: Stats; isFifo: boolean } | null> {
  let linkStats: Stats
  try {
    linkStats = await lstat(sourcePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw err
  }

  if (linkStats.isSymbolicLink()) {
    let targetStats: Stats
    try {
      targetStats = await stat(sourcePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      throw err
    }
    return { stats: targetStats, isFifo: targetStats.isFIFO() }
  }

  return { stats: linkStats, isFifo: linkStats.isFIFO() }
}

async function captureFifoBytes(sourcePath: string, timeoutMs: number): Promise<Buffer> {
  // O_NONBLOCK so open() returns immediately even when no writer is attached.
  // POSIX FIFO read semantics on a non-blocking FD:
  //   - writer currently open + empty buffer  → EAGAIN
  //   - no writer open + empty buffer         → 0 (EOF)
  // We can't tell "no writer yet" from "real EOF after writer close" except by
  // tracking whether any data has arrived: a 0-byte read before any data means
  // no writer is attached yet, so we keep polling until the timer fires.
  const handle = await fsOpen(sourcePath, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK)
  const buf = Buffer.alloc(64 * 1024)
  const chunks: Buffer[] = []
  let totalBytes = 0
  const deadline = Date.now() + timeoutMs

  try {
    while (true) {
      if (Date.now() > deadline) {
        throw new EnvCaptureTimeoutError(
          `Timed out after ${timeoutMs}ms while reading FIFO at "${sourcePath}"`,
        )
      }

      let bytesRead = 0
      try {
        ;({ bytesRead } = await handle.read(buf, 0, buf.length, null))
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        if (code === 'EAGAIN' || code === 'EWOULDBLOCK') {
          await new Promise((r) => setTimeout(r, 25))
          continue
        }
        throw err
      }

      if (bytesRead === 0) {
        if (totalBytes > 0) {
          // Real EOF: writer attached, wrote, and closed.
          return Buffer.concat(chunks)
        }
        // No writer yet — wait and try again.
        await new Promise((r) => setTimeout(r, 25))
        continue
      }

      totalBytes += bytesRead
      if (totalBytes > MAX_ENV_CAPTURE_BYTES) {
        throw new EnvCaptureTooLargeError(
          `FIFO at "${sourcePath}" exceeded ${MAX_ENV_CAPTURE_BYTES} bytes`,
        )
      }
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)))
    }
  } finally {
    await handle.close().catch(() => {})
  }
}

async function copyCredentialFile(
  sourcePath: string,
  destinationPath: string,
  options: CopyFileOptions,
): Promise<void> {
  if (!options.overwrite && existsSync(destinationPath)) return

  try {
    const effective = await resolveEffectiveStat(sourcePath)
    if (!effective) return

    await mkdir(dirname(destinationPath), { recursive: true })

    if (effective.isFifo) {
      if (!options.envLike) return
      const buf = await captureFifoBytes(sourcePath, options.captureFifoTimeoutMs)
      await writeFile(destinationPath, buf, { mode: 0o600 })
      return
    }

    await copyFile(sourcePath, destinationPath)
  } catch (err) {
    if (!options.required) return
    throw new RequiredCredentialCopyError(
      `Failed to copy required worktree credential "${options.relativePath}": ${describeError(err)}`,
    )
  }
}

async function copyDirectoryIfMissing(sourcePath: string, destinationPath: string): Promise<void> {
  if (existsSync(destinationPath)) return

  await mkdir(dirname(destinationPath), { recursive: true }).catch(() => {})
  await cp(sourcePath, destinationPath, { recursive: true, force: false }).catch(() => {})
}

async function walkAndCopy(
  sourceRoot: string,
  relativeDir: string,
  destinationRoot: string,
  rules: PreparedRule[],
  captureFifoTimeoutMs: number,
): Promise<void> {
  const directoryPath = relativeDir ? join(sourceRoot, relativeDir) : sourceRoot

  try {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    for (const entry of entries) {
      const nextRelativePath = relativeDir ? join(relativeDir, entry.name) : entry.name
      const sourcePath = join(sourceRoot, nextRelativePath)
      const destinationPath = join(destinationRoot, nextRelativePath)

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        if (matchesRule(nextRelativePath, true, rules)) {
          await copyDirectoryIfMissing(sourcePath, destinationPath)
          continue
        }
        await walkAndCopy(sourceRoot, nextRelativePath, destinationRoot, rules, captureFifoTimeoutMs)
        continue
      }

      const isFileLike = entry.isFile() || entry.isFIFO() || entry.isSymbolicLink()
      if (isFileLike && matchesRule(nextRelativePath, false, rules)) {
        const envLike = isEnvLikePath(nextRelativePath)
        await copyCredentialFile(sourcePath, destinationPath, {
          overwrite: envLike,
          required: envLike,
          envLike,
          relativePath: toPosixPath(nextRelativePath),
          captureFifoTimeoutMs,
        })
      }
    }
  } catch (err) {
    if (err instanceof RequiredCredentialCopyError) throw err
    if (!relativeDir) {
      throw new Error(`Failed to scan worktree credential artifacts: ${describeError(err)}`)
    }
    // Best-effort copy to preserve worktree creation flow.
  }
}

export async function copyWorktreeCredentialArtifacts(
  sourceRoot: string,
  destinationRoot: string,
  rules?: WorktreeCredentialRule[],
  options?: { envCaptureTimeoutMs?: number },
): Promise<void> {
  const preparedRules = normalizeWorktreeCredentialRules(rules)
    .filter((rule) => rule.enabled)
    .map((rule) => ({
      ...rule,
      normalizedPattern: normalizeWorktreeCredentialPattern(rule.pattern),
      matcher: rule.kind === 'glob'
        ? compileGlob(normalizeWorktreeCredentialPattern(rule.pattern))
        : undefined,
    }))

  if (preparedRules.length === 0) return
  const captureFifoTimeoutMs = options?.envCaptureTimeoutMs ?? DEFAULT_ENV_CAPTURE_TIMEOUT_MS
  await walkAndCopy(sourceRoot, '', destinationRoot, preparedRules, captureFifoTimeoutMs)
}
