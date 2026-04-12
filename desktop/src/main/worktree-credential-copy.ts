import { existsSync } from 'fs'
import { copyFile, cp, mkdir, readdir } from 'fs/promises'
import { basename, dirname, join, sep } from 'path'
import { SKIP_DIRS as FILE_SKIP_DIRS } from './file-service'
import {
  normalizeWorktreeCredentialPattern,
  normalizeWorktreeCredentialRules,
  type WorktreeCredentialRule,
} from '../shared/worktree-credentials'

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
  relativePath: string
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function copyCredentialFile(
  sourcePath: string,
  destinationPath: string,
  options: CopyFileOptions,
): Promise<void> {
  if (!options.overwrite && existsSync(destinationPath)) return

  try {
    await mkdir(dirname(destinationPath), { recursive: true })
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
        await walkAndCopy(sourceRoot, nextRelativePath, destinationRoot, rules)
        continue
      }

      if (entry.isFile() && matchesRule(nextRelativePath, false, rules)) {
        const envLike = isEnvLikePath(nextRelativePath)
        await copyCredentialFile(sourcePath, destinationPath, {
          overwrite: envLike,
          required: envLike,
          relativePath: toPosixPath(nextRelativePath),
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
  await walkAndCopy(sourceRoot, '', destinationRoot, preparedRules)
}
