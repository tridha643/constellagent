import { listAnnotations, computeStaleFlags } from '../index.js';
import { getAnnotationDiffText, getCurrentBranchSync } from '../graphite.js';
export async function runList(db, args, ctx) {
    let file;
    let branch;
    let json = false;
    let includeStale = false;
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--file':
                file = args[++i];
                break;
            case '--branch':
                branch = args[++i];
                break;
            case '--json':
                json = true;
                break;
            case '--include-stale':
                includeStale = true;
                break;
            default:
                throw new Error(`Unknown option: ${args[i]}`);
        }
    }
    const rows = await listAnnotations(db, {
        workspace_id: ctx.workspaceId,
        repo_root: ctx.repoRoot ?? undefined,
        file_path: file,
        branch,
    });
    if (json) {
        let staleMap;
        if (includeStale && ctx.repoRoot) {
            try {
                const currentBranch = getCurrentBranchSync(ctx.repoRoot);
                const diffText = getAnnotationDiffText(ctx.repoRoot, currentBranch);
                staleMap = computeStaleFlags(rows, diffText);
            }
            catch { /* no diff available */ }
        }
        const output = rows.map((r) => ({
            ...r,
            ...(staleMap ? { stale: staleMap.get(r.id) ?? false } : {}),
        }));
        console.log(JSON.stringify(output, null, 2));
    }
    else {
        if (rows.length === 0) {
            console.log('No annotations found.');
            return;
        }
        for (const r of rows) {
            const resolvedTag = r.resolved ? ' [resolved]' : '';
            const branchTag = r.branch ? ` [${r.branch}]` : '';
            const authorTag = r.author ? ` (${r.author})` : '';
            const range = r.line_start === r.line_end ? `${r.line_start}` : `${r.line_start}-${r.line_end}`;
            console.log(`${r.file_path}:${range} (${r.side})${authorTag}${branchTag}${resolvedTag}`);
            console.log(`  ${r.summary}`);
            console.log(`  id: ${r.id}`);
            console.log();
        }
    }
}
