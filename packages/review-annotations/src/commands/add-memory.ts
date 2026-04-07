import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { addMemory, type Client } from '../index.js'
import { getCurrentBranchSync } from '../graphite.js'

function normalizeWorktreePath(value: string): string {
  const resolved = resolve(value)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

export async function runAddMemory(
  db: Client,
  args: string[],
  ctx: { workspaceId: string; repoRoot: string; worktreePath: string },
) {
  let summary: string | undefined
  let details: string | undefined
  let key: string | undefined
  let author: string | undefined
  let branch: string | undefined
  let worktree: string | undefined

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--summary': summary = args[++i]; break
      case '--details': details = args[++i]; break
      case '--key': key = args[++i]; break
      case '--author': author = args[++i]; break
      case '--branch': branch = args[++i]; break
      case '--worktree': worktree = args[++i]; break
      default:
        throw new Error(`Unknown option: ${args[i]}`)
    }
  }

  if (!summary) throw new Error('--summary is required')

  const row = await addMemory(db, {
    workspace_id: ctx.workspaceId,
    repo_root: ctx.repoRoot,
    worktree_path: worktree ? normalizeWorktreePath(worktree) : ctx.worktreePath,
    branch: branch ?? getCurrentBranchSync(ctx.repoRoot),
    author: author ?? null,
    key: key ?? null,
    summary,
    details: details ?? null,
  })

  console.log(JSON.stringify(row))
}
