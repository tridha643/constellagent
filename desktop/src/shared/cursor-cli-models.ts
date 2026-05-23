const ANSI_ESCAPE_RE = /\u001B\[[0-9;]*m/g

const IGNORED_CURSOR_LIST_LINE_PREFIXES = [
  'available models',
  'models:',
  'listing models',
  'using ',
  'warning:',
  'error:',
  'info:',
]

function cleanCursorListLine(rawLine: string): string {
  return rawLine.replace(ANSI_ESCAPE_RE, '').trim()
}

function isIgnoredCursorListLine(line: string): boolean {
  if (!line) return true
  if (/^[-=]{3,}$/.test(line)) return true
  const normalized = line.replace(/\s+/g, ' ').toLowerCase()
  return IGNORED_CURSOR_LIST_LINE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

function extractCursorModelId(line: string): string | null {
  const dashMatch = line.match(/^([a-z0-9][a-z0-9._-]*)\s+-\s+/i)
  if (!dashMatch) return null
  return dashMatch[1]!.toLowerCase()
}

/** Parse `cursor-agent --list-models` output into canonical model ids. */
export function parseCursorAgentListModels(stdout: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = cleanCursorListLine(rawLine)
    if (isIgnoredCursorListLine(line)) continue

    const modelId = extractCursorModelId(line)
    if (!modelId || seen.has(modelId)) continue

    seen.add(modelId)
    out.push(modelId)
  }

  return out
}

export function parseCursorAgentListModelsOrThrow(stdout: string): string[] {
  const models = parseCursorAgentListModels(stdout)
  if (models.length > 0) return models

  const cleanedLines = stdout
    .split(/\r?\n/)
    .map(cleanCursorListLine)
    .filter((line) => line.length > 0)

  if (cleanedLines.length === 0) return []
  if (/\b(no|0)\s+models?\b/i.test(stdout)) return []
  throw new Error('Unable to parse `cursor-agent --list-models` output')
}
