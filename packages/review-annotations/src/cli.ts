#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { openAnnotationsDb, type Client } from './index.js'

import { runAdd } from './commands/add.js'
import { runList } from './commands/list.js'
import { runRemove } from './commands/remove.js'
import { runClear } from './commands/clear.js'
import { runResolve } from './commands/resolve.js'
import { runCleanDeleted } from './commands/clean-deleted.js'
import { runAddMemory } from './commands/add-memory.js'
import { runListMemories } from './commands/list-memories.js'
import { runSearchMemories } from './commands/search-memories.js'
import { runRemoveMemory } from './commands/remove-memory.js'

function getRepoRoot(): string | null {
  try {
    const raw = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim()
    return realpathSync(raw)
  } catch {
    return null
  }
}

function resolveDbPath(explicitDb?: string): string {
  if (explicitDb) return explicitDb

  const repoRoot = getRepoRoot()
  if (repoRoot) {
    const constellDir = join(repoRoot, '.constellagent')
    if (existsSync(constellDir)) {
      return join(constellDir, 'review-annotations.db')
    }
  }

  const xdg = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  const dir = join(xdg, 'constellagent')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'review-annotations.db')
}

function getWorkspaceId(): string {
  return process.env.CONSTELLAGENT_WORKSPACE_ID || 'cli-local'
}

/** Pull `--db` / `--workspace-id` out of argv so they work before or after the subcommand. */
function extractGlobalFlags(argv: string[]): {
  dbFlag?: string
  wsFlag?: string
  rest: string[]
} {
  const rest: string[] = []
  let dbFlag: string | undefined
  let wsFlag: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--db' && argv[i + 1]) {
      dbFlag = argv[++i]
      continue
    }
    if (a === '--workspace-id' && argv[i + 1]) {
      wsFlag = argv[++i]
      continue
    }
    rest.push(a)
  }
  return { dbFlag, wsFlag, rest }
}

const USAGE = `Usage: constell-annotate <command> [options]

Commands:
  add            Add a review annotation
  add-memory     Add a repo-scoped memory row
  list           List annotations
  list-memories  List memory rows
  search-memories  Search memory rows (FTS5 full-text)
  remove         Remove an annotation by id
  remove-memory  Remove a memory row by id
  clear          Clear annotations
  clean-deleted  Remove annotations for deleted files
  resolve        Mark annotation as resolved
  unresolve      Mark annotation as unresolved

Global options:
  --db <path>           Explicit DB file path
  --workspace-id <id>   Workspace ID (default: cli-local or CONSTELLAGENT_WORKSPACE_ID)
  --help                Show this help
`

async function main() {
  const { dbFlag, wsFlag, rest } = extractGlobalFlags(process.argv.slice(2))
  if (rest.length === 0 || rest[0] === '--help' || rest[0] === '-h') {
    console.log(USAGE)
    process.exit(0)
  }

  const command = rest[0]
  const cleaned = rest.slice(1)

  const dbPath = resolveDbPath(dbFlag)
  const workspaceId = wsFlag || getWorkspaceId()
  const repoRoot = getRepoRoot()

  if (!repoRoot && (command === 'add' || command === 'clean-deleted' || command === 'add-memory')) {
    console.error('Error: not inside a git repository')
    process.exit(1)
  }

  const db = await openAnnotationsDb(dbPath)

  try {
    switch (command) {
      case 'add':
        await runAdd(db, cleaned, { workspaceId, repoRoot: repoRoot! })
        break
      case 'add-memory':
        await runAddMemory(db, cleaned, { workspaceId, repoRoot: repoRoot!, worktreePath: repoRoot! })
        break
      case 'list':
        await runList(db, cleaned, { workspaceId, repoRoot })
        break
      case 'list-memories':
        await runListMemories(db, cleaned, { workspaceId, repoRoot })
        break
      case 'search-memories':
        await runSearchMemories(db, cleaned, { workspaceId, repoRoot })
        break
      case 'remove':
        await runRemove(db, cleaned)
        break
      case 'remove-memory':
        await runRemoveMemory(db, cleaned)
        break
      case 'clear':
        await runClear(db, cleaned, { workspaceId, repoRoot })
        break
      case 'clean-deleted':
        await runCleanDeleted(db, cleaned, { workspaceId, repoRoot: repoRoot! })
        break
      case 'resolve':
        await runResolve(db, cleaned, true)
        break
      case 'unresolve':
        await runResolve(db, cleaned, false)
        break
      default:
        console.error(`Unknown command: ${command}`)
        console.log(USAGE)
        process.exit(1)
    }
  } finally {
    db.close()
  }
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
