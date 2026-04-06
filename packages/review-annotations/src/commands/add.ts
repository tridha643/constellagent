import { execSync } from 'node:child_process'
import { addAnnotation, type Client } from '../index.js'
import { getAnnotationDiffText, getCurrentBranchSync } from '../graphite.js'

function parseLineRange(value: string): { start: number; end: number } {
  const parts = value.split('-')
  if (parts.length === 1) {
    const n = parseInt(parts[0], 10)
    if (isNaN(n) || n < 1) throw new Error(`Invalid line number: ${value}`)
    return { start: n, end: n }
  }
  if (parts.length === 2) {
    const s = parseInt(parts[0], 10)
    const e = parseInt(parts[1], 10)
    if (isNaN(s) || isNaN(e) || s < 1 || e < s)
      throw new Error(`Invalid line range: ${value}`)
    return { start: s, end: e }
  }
  throw new Error(`Invalid line range format: ${value}`)
}

export async function runAdd(
  db: Client,
  args: string[],
  ctx: { workspaceId: string; repoRoot: string },
) {
  let file: string | undefined
  let newLine: string | undefined
  let oldLine: string | undefined
  let summary: string | undefined
  let author: string | undefined
  let rationale: string | undefined
  let branch: string | undefined
  let force = false

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file': file = args[++i]; break
      case '--new-line': newLine = args[++i]; break
      case '--old-line': oldLine = args[++i]; break
      case '--summary': summary = args[++i]; break
      case '--author': author = args[++i]; break
      case '--rationale': rationale = args[++i]; break
      case '--branch': branch = args[++i]; break
      case '--force': force = true; break
      default:
        throw new Error(`Unknown option: ${args[i]}`)
    }
  }

  if (!file) throw new Error('--file is required')
  if (!summary) throw new Error('--summary is required')
  if (!newLine && !oldLine) throw new Error('--new-line or --old-line is required')

  const side: 'new' | 'old' = oldLine && !newLine ? 'old' : 'new'
  const range = parseLineRange((side === 'old' ? oldLine : newLine)!)

  // Auto-detect branch and Graphite-aware diff coverage
  const detectedBranch = branch ?? getCurrentBranchSync(ctx.repoRoot)

  let diffText: string | undefined
  let headSha: string | undefined
  if (!force) {
    diffText = getAnnotationDiffText(ctx.repoRoot, detectedBranch)
  }
  try {
    headSha = execSync('git rev-parse HEAD', { cwd: ctx.repoRoot, encoding: 'utf-8' }).trim()
  } catch { /* no HEAD yet */ }

  const row = await addAnnotation(
    db,
    {
      workspace_id: ctx.workspaceId,
      repo_root: ctx.repoRoot,
      file_path: file,
      side,
      line_start: range.start,
      line_end: range.end,
      summary,
      rationale: rationale ?? null,
      author: author ?? null,
      head_sha: headSha ?? null,
      branch: detectedBranch ?? null,
    },
    { force, diffText },
  )

  console.log(JSON.stringify({ id: row.id, file_path: row.file_path, side: row.side, line_start: row.line_start, line_end: row.line_end }))
}
