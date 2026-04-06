import { type Client } from '../index.js';
export declare function runClear(db: Client, args: string[], ctx: {
    workspaceId: string;
    repoRoot: string | null;
}): Promise<void>;
