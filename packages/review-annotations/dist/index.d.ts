import type { Client } from '@libsql/client';
export type { Client } from '@libsql/client';
export interface ReviewAnnotation {
    id: string;
    workspace_id: string | null;
    repo_root: string;
    worktree_path: string | null;
    file_path: string;
    side: 'new' | 'old';
    line_start: number;
    line_end: number;
    summary: string;
    rationale: string | null;
    author: string | null;
    head_sha: string | null;
    branch: string | null;
    resolved: boolean;
    created_at: string;
    updated_at: string;
}
export interface HunkRange {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
}
export interface ParsedFileDiff {
    filePath: string;
    hunks: HunkRange[];
}
export interface ValidationResult {
    valid: boolean;
    hunkIndex?: number;
    error?: string;
}
export interface AddAnnotationInput {
    workspace_id?: string | null;
    repo_root: string;
    worktree_path?: string | null;
    file_path: string;
    side?: 'new' | 'old';
    line_start: number;
    line_end?: number;
    summary: string;
    rationale?: string | null;
    author?: string | null;
    head_sha?: string | null;
    branch?: string | null;
}
export interface ReviewMemory {
    id: string;
    workspace_id: string | null;
    repo_root: string;
    worktree_path: string | null;
    branch: string | null;
    author: string | null;
    key: string | null;
    summary: string;
    details: string | null;
    created_at: string;
    updated_at: string;
}
export interface AddMemoryInput {
    workspace_id?: string | null;
    repo_root: string;
    worktree_path?: string | null;
    branch?: string | null;
    author?: string | null;
    key?: string | null;
    summary: string;
    details?: string | null;
}
export interface ListAnnotationFilters {
    workspace_id?: string | null;
    repo_root?: string;
    file_path?: string;
    branch?: string;
}
export interface ListMemoryFilters {
    workspace_id?: string | null;
    repo_root?: string;
    worktree_path?: string | null;
    branch?: string | null;
    author?: string | null;
    key?: string | null;
}
/** Scope filters match {@link ListMemoryFilters}; `query` is full-text search over summary, details, and key. */
export interface SearchMemoryFilters extends ListMemoryFilters {
    query: string;
}
export declare function ensureReviewAnnotationsSchema(db: Client): Promise<void>;
/** Build an FTS5 MATCH string: whitespace-split tokens joined with AND; simple tokens use prefix `term*`, others are quoted. */
export declare function buildFtsMemoryQuery(userQuery: string): string;
/** Escape `%`, `_`, and `\` for use inside a LIKE pattern with `ESCAPE '\\'`. */
export declare function escapeLikeFragmentForEscapeClause(fragment: string): string;
export declare function openAnnotationsDb(dbPath: string): Promise<Client>;
export declare function parseUnifiedDiff(diffText: string): ParsedFileDiff[];
export declare function validateRangeInDiff(parsedDiffs: ParsedFileDiff[], filePath: string, side: 'new' | 'old', lineStart: number, lineEnd: number): ValidationResult;
export declare function addAnnotation(db: Client, input: AddAnnotationInput, opts?: {
    force?: boolean;
    diffText?: string;
}): Promise<ReviewAnnotation>;
export declare function listAnnotations(db: Client, filters?: ListAnnotationFilters): Promise<ReviewAnnotation[]>;
export declare function removeAnnotation(db: Client, id: string): Promise<void>;
export declare function clearAnnotations(db: Client, filters?: ListAnnotationFilters): Promise<void>;
export declare function addMemory(db: Client, input: AddMemoryInput): Promise<ReviewMemory>;
export declare function listMemories(db: Client, filters?: ListMemoryFilters): Promise<ReviewMemory[]>;
export declare function searchMemories(db: Client, filters: SearchMemoryFilters): Promise<ReviewMemory[]>;
export declare function removeMemory(db: Client, id: string): Promise<void>;
export declare function setResolved(db: Client, id: string, resolved: boolean): Promise<void>;
export declare function computeStaleFlags(annotations: ReviewAnnotation[], diffText: string): Map<string, boolean>;
