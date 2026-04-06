import { clearAnnotations } from '../index.js';
import { getCurrentBranchSync, getDeletedFilesForAnnotationCleanup } from '../graphite.js';
export async function runCleanDeleted(db, args, ctx) {
    let base;
    let dryRun = false;
    let json = false;
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--base':
                base = args[++i];
                break;
            case '--dry-run':
                dryRun = true;
                break;
            case '--json':
                json = true;
                break;
            default:
                throw new Error(`Unknown option: ${args[i]}`);
        }
    }
    const branch = getCurrentBranchSync(ctx.repoRoot);
    const deletedFiles = getDeletedFilesForAnnotationCleanup(ctx.repoRoot, branch, base);
    if (deletedFiles.length === 0) {
        if (json) {
            console.log(JSON.stringify({ deleted: 0, files: [] }));
        }
        else {
            console.log('No deleted files with annotations found.');
        }
        return;
    }
    const cleanedFiles = [];
    for (const file of deletedFiles) {
        if (!dryRun) {
            await clearAnnotations(db, {
                workspace_id: ctx.workspaceId,
                repo_root: ctx.repoRoot,
                file_path: file,
            });
        }
        cleanedFiles.push(file);
    }
    if (json) {
        console.log(JSON.stringify({ deleted: cleanedFiles.length, files: cleanedFiles, dryRun }));
    }
    else {
        const prefix = dryRun ? '[dry-run] Would clean' : 'Cleaned';
        console.log(`${prefix} annotations for ${cleanedFiles.length} deleted file(s):`);
        for (const f of cleanedFiles) {
            console.log(`  ${f}`);
        }
    }
}
