import { clearAnnotations } from '../index.js';
export async function runClear(db, args, ctx) {
    let file;
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--file':
                file = args[++i];
                break;
            default:
                throw new Error(`Unknown option: ${args[i]}`);
        }
    }
    await clearAnnotations(db, {
        workspace_id: ctx.workspaceId,
        repo_root: ctx.repoRoot ?? undefined,
        file_path: file,
    });
    console.log('Annotations cleared.');
}
