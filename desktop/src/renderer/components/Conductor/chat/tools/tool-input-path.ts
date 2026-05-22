function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function firstString(input: unknown, keys: string[]): string | undefined {
  if (typeof input === 'string') return input.trim() || undefined
  const record = asRecord(input)
  if (!record) return undefined
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function pathFromInput(input: unknown): string | undefined {
  return firstString(input, ['path', 'file_path', 'filePath', 'target_file', 'targetFile', 'relative_path'])
}

/** Path keys from object payloads only — never treats plain strings (e.g. shell commands) as paths. */
export function pathFromObjectInput(input: unknown): string | undefined {
  if (typeof input === 'string') return undefined
  const record = asRecord(input)
  if (!record) return undefined
  for (const key of ['path', 'file_path', 'filePath', 'target_file', 'targetFile', 'relative_path']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function queryFromInput(input: unknown): string | undefined {
  return firstString(input, ['query', 'pattern', 'q', 'search', 'regex'])
}
