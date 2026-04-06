import { type Client } from '../index.js';
export declare function runList(db: Client, args: string[], ctx: {
    workspaceId: string;
    repoRoot: string | null;
}): Promise<void>;
