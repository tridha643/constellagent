import { clearAnnotations, type Client } from '../index.js'

export async function runClear(
  db: Client,
  args: string[],
  ctx: { workspaceId: string; repoRoot: string | null },
) {
  let file: string | undefined
  let branch: string | undefined

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file': file = args[++i]; break
      case '--branch': branch = args[++i]; break
      default:
        throw new Error(`Unknown option: ${args[i]}`)
    }
  }

  await clearAnnotations(db, {
    workspace_id: ctx.workspaceId,
    repo_root: ctx.repoRoot ?? undefined,
    file_path: file,
    branch,
  })

  console.log('Annotations cleared.')
}
