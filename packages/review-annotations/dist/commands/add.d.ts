import { type Client } from '../index.js';
export declare function runAdd(db: Client, args: string[], ctx: {
    workspaceId: string;
    repoRoot: string;
}): Promise<void>;
