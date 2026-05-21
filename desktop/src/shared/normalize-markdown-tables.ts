/** Parse pipe-separated cells from a GFM table row. */
export function parseMarkdownTableCells(line: string): string[] {
  const trimmed = line.trim()
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const stripped = inner.endsWith('|') ? inner.slice(0, -1) : inner
  return stripped.split('|').map((c) => c.trim())
}

function isDelimiterCell(cell: string): boolean {
  return /^:?-+:?$/.test(cell)
}

function isTableRowLine(line: string): boolean {
  const t = line.trim()
  return t.includes('|') && (t.startsWith('|') || t.endsWith('|'))
}

function isDelimiterRowLine(line: string): boolean {
  const cells = parseMarkdownTableCells(line)
  return cells.length > 0 && cells.every(isDelimiterCell)
}

/**
 * Fix common agent-generated table mistakes (e.g. `|---|` for a 3-column header)
 * so GFM parsers and renderers can recognize the block.
 */
export function normalizeMarkdownTables(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = lines[i + 1]

    if (
      next !== undefined &&
      isTableRowLine(line) &&
      isDelimiterRowLine(next)
    ) {
      const headerCells = parseMarkdownTableCells(line)
      const delimCells = parseMarkdownTableCells(next)

      if (
        headerCells.length > 1 &&
        delimCells.length === 1 &&
        isDelimiterCell(delimCells[0] ?? '')
      ) {
        const rebuilt = `| ${headerCells.map(() => '---').join(' | ')} |`
        out.push(line, rebuilt)
        i += 1
        continue
      }

      if (headerCells.length > 0 && delimCells.length > 0 && delimCells.length !== headerCells.length) {
        const rebuilt = `| ${headerCells
          .map((_, idx) => delimCells[idx] ?? '---')
          .join(' | ')} |`
        out.push(line, rebuilt)
        i += 1
        continue
      }
    }

    out.push(line)
  }

  return out.join('\n')
}
