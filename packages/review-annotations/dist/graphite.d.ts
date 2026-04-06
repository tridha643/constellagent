/**
 * Get the parent branch for a given branch from Graphite metadata.
 * Returns null if no Graphite metadata found or branch has no parent.
 */
export declare function getGraphiteParentBranch(repoPath: string, branchName: string): string | null;
/**
 * Get the current branch name. Returns null if HEAD is detached.
 */
export declare function getCurrentBranchSync(cwd: string): string | null;
export declare function getGraphiteDiffBase(repoPath: string, branchName?: string | null): string;
/**
 * Return a unified diff that covers both the tracked Graphite branch delta and
 * any local worktree changes on top of HEAD.
 */
export declare function getAnnotationDiffText(repoPath: string, branchName?: string | null): string;
export declare function getDeletedFilesForAnnotationCleanup(repoPath: string, branchName?: string | null, explicitBase?: string): string[];
