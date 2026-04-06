import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
function gitSync(args, cwd) {
    return execSync(`git ${args.join(' ')}`, {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
    }).trimEnd();
}
function resolveGitCommonDirSync(repoPath) {
    const rel = gitSync(['rev-parse', '--git-common-dir'], repoPath);
    return resolve(repoPath, rel);
}
/**
 * Parse graphite branch metadata from .graphite_metadata.db (Graphite CLI >= ~1.0).
 */
function parseGraphiteSqliteMetadataSync(gitCommonDir) {
    const dbPath = join(gitCommonDir, '.graphite_metadata.db');
    if (!existsSync(dbPath))
        return new Map();
    const map = new Map();
    try {
        const stdout = execSync(`sqlite3 ${JSON.stringify(dbPath)} -separator $'\\t' 'SELECT branch_name, parent_branch_name FROM branch_metadata WHERE parent_branch_name IS NOT NULL AND parent_branch_name != "";'`, { encoding: 'utf-8', maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trimEnd();
        for (const line of stdout.split('\n')) {
            if (!line)
                continue;
            const [branch, parent] = line.split('\t');
            if (branch && parent)
                map.set(branch, parent);
        }
    }
    catch {
        // sqlite3 not available or DB unreadable
    }
    return map;
}
/**
 * Parse graphite branch metadata from refs/branch-metadata/ (older CLI).
 */
function parseGraphiteRefMetadataSync(repoPath) {
    const map = new Map();
    try {
        const refsOutput = gitSync(['for-each-ref', '--format=%(refname)', 'refs/branch-metadata/'], repoPath);
        for (const refName of refsOutput.split('\n')) {
            if (!refName)
                continue;
            const branchName = refName.replace('refs/branch-metadata/', '');
            try {
                const blob = gitSync(['cat-file', '-p', refName], repoPath);
                const meta = JSON.parse(blob);
                const parent = meta.parentBranchName ?? meta.parent;
                if (typeof parent === 'string' && parent) {
                    map.set(branchName, parent);
                }
            }
            catch {
                // Unparseable ref
            }
        }
    }
    catch {
        // No refs/branch-metadata/
    }
    return map;
}
/**
 * Parse graphite branch metadata from git config (legacy / cloneStack fallback).
 */
function parseGraphiteConfigMetadataSync(repoPath) {
    const map = new Map();
    try {
        const output = gitSync(['config', '--get-regexp', '^graphite\\.branch\\.'], repoPath);
        for (const line of output.split('\n')) {
            if (!line)
                continue;
            const match = line.match(/^graphite\.branch\.(.+)\.parent\s+(.+)$/);
            if (match) {
                map.set(match[1], match[2]);
            }
        }
    }
    catch {
        // No graphite config entries
    }
    return map;
}
/**
 * Collect graphite parent metadata from all known sources.
 * Priority: SQLite DB > refs > git config. Falls back through each.
 */
function parseGraphiteMetadataSync(repoPath) {
    let gitCommonDir;
    try {
        gitCommonDir = resolveGitCommonDirSync(repoPath);
    }
    catch {
        return new Map();
    }
    const map = parseGraphiteSqliteMetadataSync(gitCommonDir);
    if (map.size > 0)
        return map;
    const refMap = parseGraphiteRefMetadataSync(repoPath);
    if (refMap.size > 0)
        return refMap;
    return parseGraphiteConfigMetadataSync(repoPath);
}
/**
 * Get the parent branch for a given branch from Graphite metadata.
 * Returns null if no Graphite metadata found or branch has no parent.
 */
export function getGraphiteParentBranch(repoPath, branchName) {
    const parentMap = parseGraphiteMetadataSync(repoPath);
    return parentMap.get(branchName) ?? null;
}
/**
 * Get the current branch name. Returns null if HEAD is detached.
 */
export function getCurrentBranchSync(cwd) {
    try {
        const branch = gitSync(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
        if (!branch || branch === 'HEAD')
            return null;
        return branch;
    }
    catch {
        return null;
    }
}
function safeGitOutputSync(args, cwd) {
    try {
        return gitSync(args, cwd);
    }
    catch {
        return '';
    }
}
export function getGraphiteDiffBase(repoPath, branchName) {
    if (branchName) {
        const parent = getGraphiteParentBranch(repoPath, branchName);
        if (parent) {
            return `${parent}...HEAD`;
        }
    }
    return 'HEAD';
}
/**
 * Return a unified diff that covers both the tracked Graphite branch delta and
 * any local worktree changes on top of HEAD.
 */
export function getAnnotationDiffText(repoPath, branchName) {
    const diffBase = getGraphiteDiffBase(repoPath, branchName);
    const parts = [];
    const branchDiff = safeGitOutputSync(['diff', diffBase], repoPath);
    if (branchDiff)
        parts.push(branchDiff);
    if (diffBase !== 'HEAD') {
        const worktreeDiff = safeGitOutputSync(['diff', 'HEAD'], repoPath);
        if (worktreeDiff)
            parts.push(worktreeDiff);
    }
    return parts.join('\n');
}
export function getDeletedFilesForAnnotationCleanup(repoPath, branchName, explicitBase) {
    const files = new Set();
    const diffBase = explicitBase ?? getGraphiteDiffBase(repoPath, branchName);
    const diffTargets = diffBase === 'HEAD' ? ['HEAD'] : [diffBase, 'HEAD'];
    for (const target of diffTargets) {
        const output = safeGitOutputSync(['diff', '--name-only', '--diff-filter=D', target], repoPath);
        if (!output)
            continue;
        for (const file of output.split('\n')) {
            if (file)
                files.add(file);
        }
    }
    return [...files];
}
