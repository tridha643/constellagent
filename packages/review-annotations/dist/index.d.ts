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
}
export interface ListAnnotationFilters {
    workspace_id?: string | null;
    repo_root?: string;
    file_path?: string;
}
export declare function ensureReviewAnnotationsSchema(db: Client): Promise<void>;
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
export declare function setResolved(db: Client, id: string, resolved: boolean): Promise<void>;
export declare function computeStaleFlags(annotations: ReviewAnnotation[], diffText: string): Map<string, boolean>;
