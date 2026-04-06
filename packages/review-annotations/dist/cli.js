#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { openAnnotationsDb } from './index.js';
import { runAdd } from './commands/add.js';
import { runList } from './commands/list.js';
import { runRemove } from './commands/remove.js';
import { runClear } from './commands/clear.js';
import { runResolve } from './commands/resolve.js';
import { runCleanDeleted } from './commands/clean-deleted.js';
function getRepoRoot() {
    try {
        const raw = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
        return realpathSync(raw);
    }
    catch {
        return null;
    }
}
function resolveDbPath(explicitDb) {
    if (explicitDb)
        return explicitDb;
    const repoRoot = getRepoRoot();
    if (repoRoot) {
        const constellDir = join(repoRoot, '.constellagent');
        if (existsSync(constellDir)) {
            return join(constellDir, 'review-annotations.db');
        }
    }
    const xdg = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
    const dir = join(xdg, 'constellagent');
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return join(dir, 'review-annotations.db');
}
function getWorkspaceId() {
    return process.env.CONSTELLAGENT_WORKSPACE_ID || 'cli-local';
}
const USAGE = `Usage: constell-annotate <command> [options]

Commands:
  add            Add a review annotation
  list           List annotations
  remove         Remove an annotation by id
  clear          Clear annotations
  clean-deleted  Remove annotations for deleted files
  resolve        Mark annotation as resolved
  unresolve      Mark annotation as unresolved

Global options:
  --db <path>           Explicit DB file path
  --workspace-id <id>   Workspace ID (default: cli-local or CONSTELLAGENT_WORKSPACE_ID)
  --help                Show this help
`;
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        console.log(USAGE);
        process.exit(0);
    }
    const command = args[0];
    const rest = args.slice(1);
    let dbFlag;
    let wsFlag;
    const cleaned = [];
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--db' && rest[i + 1]) {
            dbFlag = rest[++i];
        }
        else if (rest[i] === '--workspace-id' && rest[i + 1]) {
            wsFlag = rest[++i];
        }
        else {
            cleaned.push(rest[i]);
        }
    }
    const dbPath = resolveDbPath(dbFlag);
    const workspaceId = wsFlag || getWorkspaceId();
    const repoRoot = getRepoRoot();
    if (!repoRoot && (command === 'add' || command === 'clean-deleted')) {
        console.error('Error: not inside a git repository');
        process.exit(1);
    }
    const db = await openAnnotationsDb(dbPath);
    try {
        switch (command) {
            case 'add':
                await runAdd(db, cleaned, { workspaceId, repoRoot: repoRoot });
                break;
            case 'list':
                await runList(db, cleaned, { workspaceId, repoRoot });
                break;
            case 'remove':
                await runRemove(db, cleaned);
                break;
            case 'clear':
                await runClear(db, cleaned, { workspaceId, repoRoot });
                break;
            case 'clean-deleted':
                await runCleanDeleted(db, cleaned, { workspaceId, repoRoot: repoRoot });
                break;
            case 'resolve':
                await runResolve(db, cleaned, true);
                break;
            case 'unresolve':
                await runResolve(db, cleaned, false);
                break;
            default:
                console.error(`Unknown command: ${command}`);
                console.log(USAGE);
                process.exit(1);
        }
    }
    finally {
        db.close();
    }
}
main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
