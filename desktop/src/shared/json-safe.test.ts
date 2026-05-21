import { describe, expect, test } from 'bun:test'
import { safeJsonStringify, toJsonSafe } from './json-safe'

describe('json-safe', () => {
  test('serializes BigInt values', () => {
    expect(safeJsonStringify({ count: 12n })).toBe('{"count":"12"}')
  })

  test('replaces circular references', () => {
    const value: { name: string; self?: unknown } = { name: 'tool-output' }
    value.self = value

    expect(toJsonSafe(value)).toEqual({ name: 'tool-output', self: '[Circular]' })
  })
})
