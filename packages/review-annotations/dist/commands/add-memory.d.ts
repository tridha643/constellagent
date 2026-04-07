import { type Client } from '../index.js';
export declare function runAddMemory(db: Client, args: string[], ctx: {
    workspaceId: string;
    repoRoot: string;
    worktreePath: string;
}): Promise<void>;
