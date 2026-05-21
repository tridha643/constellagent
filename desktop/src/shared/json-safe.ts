const MAX_DEPTH = 12

/**
 * Convert arbitrary SDK/tool payloads into values that can be safely cloned,
 * rendered, and JSON-serialized. Tool results can contain BigInt values or
 * circular object graphs; letting those reach React/IPC/SQLite can take down
 * the whole Conductor view.
 */
export function toJsonSafe(value: unknown, maxDepth = MAX_DEPTH): unknown {
  const seen = new WeakSet<object>()

  const visit = (input: unknown, depth: number): unknown => {
    if (input === null || input === undefined) return input

    const type = typeof input
    if (type === 'string' || type === 'number' || type === 'boolean') return input
    if (type === 'bigint') return input.toString()
    if (type === 'symbol') return String(input)
    if (type === 'function') {
      const name = (input as { name?: string }).name
      return `[Function ${name || 'anonymous'}]`
    }

    if (depth >= maxDepth) return '[Max depth reached]'

    if (input instanceof Date) return input.toISOString()
    if (input instanceof Error) {
      return {
        name: input.name,
        message: input.message,
        ...(input.stack ? { stack: input.stack } : {}),
      }
    }

    if (Array.isArray(input)) {
      if (seen.has(input)) return '[Circular]'
      seen.add(input)
      return input.map((item) => visit(item, depth + 1))
    }

    if (type === 'object') {
      const record = input as Record<string, unknown>
      if (seen.has(record)) return '[Circular]'
      seen.add(record)
      const output: Record<string, unknown> = {}
      for (const [key, nested] of Object.entries(record)) {
        output[key] = visit(nested, depth + 1)
      }
      return output
    }

    return String(input)
  }

  return visit(value, 0)
}

export function safeJsonStringify(value: unknown, space?: number): string {
  try {
    const serialized = JSON.stringify(toJsonSafe(value), null, space)
    return serialized === undefined ? String(value) : serialized
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `[Unserializable value: ${message}]`
  }
}
