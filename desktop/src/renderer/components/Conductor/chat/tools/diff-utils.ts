import { diffWords, parsePatch } from 'diff'

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
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\[[0-9;]*m/g

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

/**
 * Parse a unified git patch into a paired row model. Consecutive `-` lines are
 * paired with the following `+` lines into `modified` rows (with intra-line token
 * highlight); the remainder fall back to plain added/removed rows.
 */
export function parseDiffRows(patch: string): ParsedDiff {
  const rows: DiffRow[] = []
  let additions = 0
  let deletions = 0
  let hasNoNewline = false

  let structured: ReturnType<typeof parsePatch>
  try {
    structured = parsePatch(patch)
  } catch {
    return { rows, additions, deletions, hasNoNewline }
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
          const { leftTokens, rightTokens } = tokenizeModified(left, right)
          rows.push({
            type: 'modified',
            left,
            right,
            leftNo: oldLine++,
            rightNo: newLine++,
            leftTokens,
            rightTokens,
          })
          deletions += 1
          additions += 1
        }
        for (let i = pairs; i < removed.length; i += 1) {
          rows.push({ type: 'removed', left: removed[i], leftNo: oldLine++ })
          deletions += 1
        }
        for (let i = pairs; i < added.length; i += 1) {
          rows.push({ type: 'added', right: added[i], rightNo: newLine++ })
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
          rows.push({
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

  return { rows, additions, deletions, hasNoNewline }
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
