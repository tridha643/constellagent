import { useMemo, type ReactNode } from 'react'
import type { DiffRow, DiffToken } from './diff-utils'
import { MAX_COMPACT_ROWS, parseDiffRows } from './diff-utils'
import styles from './CursorTool.module.css'

function renderTokens(tokens: readonly DiffToken[] | undefined, fallback: string): ReactNode {
  if (!tokens?.length) return fallback
  return tokens.map((token, i) =>
    token.highlight ? (
      <mark key={i} className={styles.cursorDiffIntraline}>
        {token.value}
      </mark>
    ) : (
      <span key={i}>{token.value}</span>
    ),
  )
}

function DiffRowLine({
  rowClass,
  sign,
  lineNo,
  content,
  tokens,
}: {
  rowClass: string
  sign: string
  lineNo?: number
  content: string
  tokens?: readonly DiffToken[]
}) {
  return (
    <div className={`${styles.cursorDiffRow} ${rowClass}`}>
      <span className={styles.cursorDiffLineNo}>{lineNo ?? ''}</span>
      <span className={styles.cursorDiffSign} aria-hidden>
        {sign}
      </span>
      <span className={styles.cursorDiffContent}>{renderTokens(tokens, content)}</span>
    </div>
  )
}

function DiffRowView({ row }: { row: DiffRow }) {
  switch (row.type) {
    case 'unchanged':
      return (
        <DiffRowLine
          rowClass={styles.cursorDiffRowContext}
          sign=" "
          lineNo={row.leftNo}
          content={row.left ?? row.right ?? ''}
        />
      )
    case 'added':
      return (
        <DiffRowLine
          rowClass={styles.cursorDiffRowAdded}
          sign="+"
          lineNo={row.rightNo}
          content={row.right ?? ''}
        />
      )
    case 'removed':
      return (
        <DiffRowLine
          rowClass={styles.cursorDiffRowRemoved}
          sign="−"
          lineNo={row.leftNo}
          content={row.left ?? ''}
        />
      )
    case 'modified':
      return (
        <>
          <DiffRowLine
            rowClass={styles.cursorDiffRowRemoved}
            sign="−"
            lineNo={row.leftNo}
            content={row.left ?? ''}
            tokens={row.leftTokens}
          />
          <DiffRowLine
            rowClass={styles.cursorDiffRowAdded}
            sign="+"
            lineNo={row.rightNo}
            content={row.right ?? ''}
            tokens={row.rightTokens}
          />
        </>
      )
    default:
      return null
  }
}

const MAX_CONTEXT_ROWS = 2

/** Unified diff body with green inset gutter on additions (Cursor screenshot style). */
export function CursorDiffCode({ patch }: { patch: string }) {
  const { rows, hasNoNewline } = useMemo(
    () => parseDiffRows(patch, { maxRows: MAX_COMPACT_ROWS }),
    [patch],
  )

  const visibleRows = useMemo(() => {
    if (rows.length === 0) return rows
    const changed = rows.filter((r) => r.type !== 'unchanged')
    if (changed.length === 0) return rows
    if (changed.length === rows.length) return rows

    const out: DiffRow[] = []
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!
      if (row.type !== 'unchanged') {
        out.push(row)
        continue
      }
      let ctxBefore = 0
      let j = i - 1
      while (j >= 0 && rows[j]?.type === 'unchanged' && ctxBefore < MAX_CONTEXT_ROWS) {
        ctxBefore += 1
        j -= 1
      }
      let ctxAfter = 0
      let k = i + 1
      while (k < rows.length && rows[k]?.type === 'unchanged' && ctxAfter < MAX_CONTEXT_ROWS) {
        ctxAfter += 1
        k += 1
      }
      const nearChange =
        (i > 0 && rows[i - 1]?.type !== 'unchanged') ||
        (i < rows.length - 1 && rows[i + 1]?.type !== 'unchanged')
      if (nearChange && (ctxBefore < MAX_CONTEXT_ROWS || ctxAfter < MAX_CONTEXT_ROWS)) {
        out.push(row)
      }
    }
    return out.length > 0 ? out : changed
  }, [rows])

  if (visibleRows.length === 0) return null

  return (
    <div className={styles.cursorDiffCode} data-testid="conductor-diff-body">
      {visibleRows.map((row, index) => (
        <DiffRowView key={`${row.type}-${row.leftNo ?? ''}-${row.rightNo ?? ''}-${index}`} row={row} />
      ))}
      {hasNoNewline ? <div className={styles.cursorDiffNoNewline}>No newline at end of file</div> : null}
    </div>
  )
}
