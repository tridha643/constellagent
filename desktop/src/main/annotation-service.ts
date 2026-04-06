import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, realpathSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Client } from '@libsql/client'
import {
  openAnnotationsDb,
  addAnnotation,
  listAnnotations,
  removeAnnotation,
  clearAnnotations,
  setResolved,
  type ReviewAnnotation,
} from '@tridha643/review-annotations'

const execFileAsync = promisify(execFile)

const dbHandles = new Map<string, Client>()

function resolveRepo(worktreePath: string): string {
  try {
    return realpathSync(worktreePath)
  } catch {
    return worktreePath
  }
}

async function gitRepoRoot(worktreePath: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
    cwd: worktreePath,
  })
  return realpathSync(stdout.trim())
}

async function gitHead(worktreePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath })
    return stdout.trim()
  } catch {
    return null
  }
}

async function gitDiffHead(worktreePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', 'HEAD'], {
      cwd: worktreePath,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout
  } catch {
    return ''
  }
}

async function getDb(projectDir: string): Promise<Client> {
  const existing = dbHandles.get(projectDir)
  if (existing) return existing

  const dir = join(projectDir, '.constellagent')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'review-annotations.db')
  const client = await openAnnotationsDb(dbPath)
  dbHandles.set(projectDir, client)
  return client
}

export const AnnotationService = {
  async addComment(
    worktreePath: string,
    file: string,
    newLine: number,
    summary: string,
    opts?: {
      rationale?: string
      author?: string
      focus?: boolean
      oldLine?: number
      force?: boolean
      lineEnd?: number
      workspaceId?: string
    },
  ): Promise<void> {
    const repoRoot = await gitRepoRoot(worktreePath)
    const db = await getDb(repoRoot)

    const side: 'new' | 'old' = opts?.oldLine != null && newLine === 0 ? 'old' : 'new'
    const lineStart = side === 'old' ? opts!.oldLine! : newLine
    const lineEnd = opts?.lineEnd ?? lineStart

    let diffText: string | undefined
    if (!opts?.force) {
      diffText = await gitDiffHead(worktreePath)
    }

    const headSha = await gitHead(worktreePath)

    await addAnnotation(
      db,
      {
        workspace_id: opts?.workspaceId ?? null,
        repo_root: repoRoot,
        worktree_path: resolveRepo(worktreePath),
        file_path: file,
        side,
        line_start: lineStart,
        line_end: lineEnd,
        summary,
        rationale: opts?.rationale ?? null,
        author: opts?.author ?? null,
        head_sha: headSha,
      },
      { force: opts?.force, diffText },
    )
  },

  async listComments(worktreePath: string, file?: string): Promise<ReviewAnnotation[]> {
    try {
      const repoRoot = await gitRepoRoot(worktreePath)
      const db = await getDb(repoRoot)
      return await listAnnotations(db, {
        repo_root: repoRoot,
        file_path: file,
      })
    } catch {
      return []
    }
  },

  async removeComment(worktreePath: string, commentId: string): Promise<void> {
    const repoRoot = await gitRepoRoot(worktreePath)
    const db = await getDb(repoRoot)
    await removeAnnotation(db, commentId)
  },

  async clearComments(worktreePath: string, file?: string): Promise<void> {
    const repoRoot = await gitRepoRoot(worktreePath)
    const db = await getDb(repoRoot)
    await clearAnnotations(db, { repo_root: repoRoot, file_path: file })
  },

  async setResolved(worktreePath: string, commentId: string, resolved: boolean): Promise<void> {
    const repoRoot = await gitRepoRoot(worktreePath)
    const db = await getDb(repoRoot)
    await setResolved(db, commentId, resolved)
  },

  cleanupAll(): void {
    for (const [, client] of dbHandles) {
      client.close()
    }
    dbHandles.clear()
  },
}
