import { type Client } from '../index.js';
export declare function runSearchMemories(db: Client, args: string[], ctx: {
    workspaceId: string;
    repoRoot: string | null;
}): Promise<void>;
