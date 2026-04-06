import { clearAnnotations } from '../index.js';
export async function runClear(db, args, ctx) {
    let file;
    let branch;
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--file':
                file = args[++i];
                break;
            case '--branch':
                branch = args[++i];
                break;
            default:
                throw new Error(`Unknown option: ${args[i]}`);
        }
    }
    await clearAnnotations(db, {
        workspace_id: ctx.workspaceId,
        repo_root: ctx.repoRoot ?? undefined,
        file_path: file,
        branch,
    });
    console.log('Annotations cleared.');
}
