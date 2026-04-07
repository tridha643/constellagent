import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { searchMemories } from '../index.js';
function normalizeWorktreePath(value) {
    const resolved = resolve(value);
    try {
        return realpathSync(resolved);
    }
    catch {
        return resolved;
    }
}
export async function runSearchMemories(db, args, ctx) {
    let query;
    let key;
    let author;
    let branch;
    let worktree;
    let json = false;
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--query':
                query = args[++i];
                break;
            case '--key':
                key = args[++i];
                break;
            case '--author':
                author = args[++i];
                break;
            case '--branch':
                branch = args[++i];
                break;
            case '--worktree':
                worktree = args[++i];
                break;
            case '--json':
                json = true;
                break;
            default:
                throw new Error(`Unknown option: ${args[i]}`);
        }
    }
    if (query === undefined || query.trim() === '') {
        throw new Error('--query <text> is required');
    }
    const rows = await searchMemories(db, {
        query,
        workspace_id: ctx.workspaceId,
        repo_root: ctx.repoRoot ?? undefined,
        worktree_path: worktree ? normalizeWorktreePath(worktree) : undefined,
        branch,
        author,
        key,
    });
    if (json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
    }
    if (rows.length === 0) {
        console.log('No memories found.');
        return;
    }
    for (const row of rows) {
        const keyTag = row.key ? ` [key=${row.key}]` : '';
        const authorTag = row.author ? ` (${row.author})` : '';
        const branchTag = row.branch ? ` [${row.branch}]` : '';
        console.log(`${row.summary}${keyTag}${authorTag}${branchTag}`);
        console.log(`  id: ${row.id}`);
        if (row.worktree_path)
            console.log(`  worktree: ${row.worktree_path}`);
        if (row.details)
            console.log(`  details: ${row.details}`);
        console.log();
    }
}
