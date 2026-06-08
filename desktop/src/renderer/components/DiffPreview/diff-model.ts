import { diffWords, parsePatch } from 'diff'
import type { WorkingTreeFileStatus } from '../../types/working-tree-diff'

export type DiffRowType = 'added' | 'removed' | 'unchanged' | 'modified'

export interface DiffToken {
  readonly value: string
  readonly highlight: boolean
}

export interface DiffRow {
  readonly type: DiffRowType
  readonly left?: string
  readonly right?: string
  readonly leftNo?: number
  readonly rightNo?: number
  readonly leftTokens?: readonly DiffToken[]
  readonly rightTokens?: readonly DiffToken[]
}

export interface ParsedDiff {
  readonly rows: readonly DiffRow[]
  readonly additions: number
  readonly deletions: number
  readonly hasNoNewline: boolean
  readonly parseError?: boolean
}

export interface DiffPreviewModel {
  readonly filePath: string
  readonly status: WorkingTreeFileStatus['status']
  readonly staged: boolean
  readonly additions: number
  readonly deletions: number
  readonly patchLineCount: number
  readonly rows: readonly DiffRow[]
  readonly hasNoNewline: boolean
  readonly parseError: boolean
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g
export const MAX_COMPACT_ROWS = 160
const DEFAULT_MAX_TOKENIZED_LINE_LENGTH = 2000

export interface ParseDiffRowsOptions {
  readonly maxRows?: number
  readonly tokenizeModifiedRows?: boolean
  readonly maxTokenizedLineLength?: number
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '')
}

/** Display path: collapse separators, drop a leading `./`, prefer a `shared/`-rooted slice. */
export function normalizePath(path: string): string {
  const cleaned = path.replace(/\\/g, '/').replace(/^\.\//, '')
  const sharedIdx = cleaned.indexOf('shared/')
  if (sharedIdx > 0) return cleaned.slice(sharedIdx)
  return cleaned
}

/** Word-level highlight for a modified (removed→added) row pair. */
function tokenizeModified(left: string, right: string): {
  leftTokens: DiffToken[]
  rightTokens: DiffToken[]
} {
  const leftTokens: DiffToken[] = []
  const rightTokens: DiffToken[] = []
  for (const part of diffWords(left, right)) {
    if (part.added) {
      rightTokens.push({ value: part.value, highlight: true })
    } else if (part.removed) {
      leftTokens.push({ value: part.value, highlight: true })
    } else {
      leftTokens.push({ value: part.value, highlight: false })
      rightTokens.push({ value: part.value, highlight: false })
    }
  }
  return { leftTokens, rightTokens }
}

function shouldTokenizeModifiedRows(
  left: string,
  right: string,
  options: Required<Pick<ParseDiffRowsOptions, 'tokenizeModifiedRows' | 'maxTokenizedLineLength'>>,
): boolean {
  return options.tokenizeModifiedRows
    && left.length <= options.maxTokenizedLineLength
    && right.length <= options.maxTokenizedLineLength
}

/** Fallback +/- counts when `parsePatch` cannot structure the hunk. */
export function countPatchLineStats(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue
    if (line.startsWith('+')) additions += 1
    else if (line.startsWith('-')) deletions += 1
  }
  return { additions, deletions }
}

export function diffStatsFromPatch(patch: string): { additions: number; deletions: number } {
  return countPatchLineStats(patch)
}

/**
 * Parse a unified git patch into a paired row model. Consecutive `-` lines are
 * paired with following `+` lines into modified rows, with intra-line tokens.
 */
function parseDiffRowsCapped(patch: string, options: Required<Pick<ParseDiffRowsOptions, 'maxRows' | 'tokenizeModifiedRows' | 'maxTokenizedLineLength'>>): ParsedDiff {
  const rows: DiffRow[] = []
  let additions = 0
  let deletions = 0
  let hasNoNewline = false
  let oldLine = 1
  let newLine = 1
  let removed: string[] = []
  let added: string[] = []
  let inHunk = false

  const canPushRow = (): boolean => rows.length < options.maxRows

  const pushRow = (row: DiffRow): void => {
    if (canPushRow()) rows.push(row)
  }

  const flush = (): void => {
    const pairs = Math.min(removed.length, added.length)
    for (let i = 0; i < pairs; i += 1) {
      const left = removed[i]!
      const right = added[i]!
      const leftNo = oldLine++
      const rightNo = newLine++
      if (canPushRow()) {
        const tokens = shouldTokenizeModifiedRows(left, right, options)
          ? tokenizeModified(left, right)
          : null
        rows.push({
          type: 'modified',
          left,
          right,
          leftNo,
          rightNo,
          leftTokens: tokens?.leftTokens,
          rightTokens: tokens?.rightTokens,
        })
      }
      additions += 1
      deletions += 1
    }
    for (let i = pairs; i < removed.length; i += 1) {
      pushRow({ type: 'removed', left: removed[i]!, leftNo: oldLine++ })
      deletions += 1
    }
    for (let i = pairs; i < added.length; i += 1) {
      pushRow({ type: 'added', right: added[i]!, rightNo: newLine++ })
      additions += 1
    }
    removed = []
    added = []
  }

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      flush()
      inHunk = true
      const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
      oldLine = header ? Number(header[1]) : 1
      newLine = header ? Number(header[2]) : 1
      continue
    }
    if (!inHunk) continue
    if (raw.startsWith('\\')) {
      hasNoNewline = true
      continue
    }
    if (!raw) continue
    const content = raw.slice(1)
    if (raw.startsWith('-')) {
      removed.push(content)
      continue
    }
    if (raw.startsWith('+')) {
      added.push(content)
      continue
    }
    if (raw.startsWith(' ') || raw === '') {
      flush()
      pushRow({
        type: 'unchanged',
        left: content,
        right: content,
        leftNo: oldLine++,
        rightNo: newLine++,
      })
    }
    if (!canPushRow()) break
  }
  flush()

  const stats = countPatchLineStats(patch)
  return {
    rows,
    additions: stats.additions,
    deletions: stats.deletions,
    hasNoNewline,
    parseError: false,
  }
}

export function parseDiffRows(patch: string, options: ParseDiffRowsOptions = {}): ParsedDiff {
  const rows: DiffRow[] = []
  let additions = 0
  let deletions = 0
  let hasNoNewline = false
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY
  const tokenizeOptions = {
    tokenizeModifiedRows: options.tokenizeModifiedRows ?? true,
    maxTokenizedLineLength: options.maxTokenizedLineLength ?? DEFAULT_MAX_TOKENIZED_LINE_LENGTH,
  }

  if (Number.isFinite(maxRows)) {
    return parseDiffRowsCapped(patch, {
      maxRows,
      tokenizeModifiedRows: tokenizeOptions.tokenizeModifiedRows,
      maxTokenizedLineLength: tokenizeOptions.maxTokenizedLineLength,
    })
  }

  const canPushRow = (): boolean => rows.length < maxRows

  const pushRow = (row: DiffRow): void => {
    if (canPushRow()) rows.push(row)
  }

  let structured: ReturnType<typeof parsePatch>
  try {
    structured = parsePatch(patch)
  } catch {
    return { rows, additions, deletions, hasNoNewline, parseError: true }
  }

  if (structured.length === 0 && patch.trim().length > 0) {
    return { rows, additions, deletions, hasNoNewline, parseError: true }
  }

  for (const file of structured) {
    for (const hunk of file.hunks) {
      let oldLine = hunk.oldStart
      let newLine = hunk.newStart
      let removed: string[] = []
      let added: string[] = []

      const flush = (): void => {
        const pairs = Math.min(removed.length, added.length)
        for (let i = 0; i < pairs; i += 1) {
          const left = removed[i]
          const right = added[i]
          const leftNo = oldLine++
          const rightNo = newLine++
          if (canPushRow()) {
            const tokens = shouldTokenizeModifiedRows(left, right, tokenizeOptions)
              ? tokenizeModified(left, right)
              : null
            rows.push({
              type: 'modified',
              left,
              right,
              leftNo,
              rightNo,
              leftTokens: tokens?.leftTokens,
              rightTokens: tokens?.rightTokens,
            })
          }
          deletions += 1
          additions += 1
        }
        for (let i = pairs; i < removed.length; i += 1) {
          const leftNo = oldLine++
          pushRow({ type: 'removed', left: removed[i], leftNo })
          deletions += 1
        }
        for (let i = pairs; i < added.length; i += 1) {
          const rightNo = newLine++
          pushRow({ type: 'added', right: added[i], rightNo })
          additions += 1
        }
        removed = []
        added = []
      }

      for (const raw of hunk.lines) {
        if (raw.startsWith('\\')) {
          hasNoNewline = true
          continue
        }
        const content = raw.slice(1)
        if (raw.startsWith('-')) {
          removed.push(content)
        } else if (raw.startsWith('+')) {
          added.push(content)
        } else {
          flush()
          pushRow({
            type: 'unchanged',
            left: content,
            right: content,
            leftNo: oldLine++,
            rightNo: newLine++,
          })
        }
      }
      flush()
    }
  }

  return { rows, additions, deletions, hasNoNewline, parseError: false }
}

export function buildDiffPreviewModel(
  patch: string,
  file: Pick<WorkingTreeFileStatus, 'path' | 'status' | 'staged'>,
): DiffPreviewModel {
  const parsed = parseDiffRows(patch, { maxRows: MAX_COMPACT_ROWS })
  const parseError = (parsed.parseError ?? false) || (patch.trim().length > 0 && parsed.rows.length === 0)
  const fallbackStats = parseError ? countPatchLineStats(patch) : null
  return {
    filePath: file.path,
    status: file.status,
    staged: file.staged,
    additions: fallbackStats?.additions ?? parsed.additions,
    deletions: fallbackStats?.deletions ?? parsed.deletions,
    patchLineCount: patch ? patch.split('\n').length : 0,
    rows: parsed.rows,
    hasNoNewline: parsed.hasNoNewline,
    parseError,
  }
}

export interface FileChangeOutput {
  readonly kind: 'fileChange'
  readonly files: ReadonlyArray<{ readonly path: string; readonly patch: string }>
}

/** Narrow the diff payload the main process attaches to a file-change tool's output. */
export function asFileChangeOutput(output: unknown): FileChangeOutput | null {
  if (
    output &&
    typeof output === 'object' &&
    (output as { kind?: unknown }).kind === 'fileChange' &&
    Array.isArray((output as { files?: unknown }).files)
  ) {
    return output as FileChangeOutput
  }
  return null
}
