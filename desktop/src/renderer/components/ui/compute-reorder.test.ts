import { describe, expect, it } from 'vitest'
import { computeReorder } from './compute-reorder'

describe('computeReorder', () => {
  it('inserts before overId', () => {
    expect(computeReorder(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b'])
  })

  it('inserts after overId', () => {
    expect(computeReorder(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a'])
  })

  it('no-op when dragged equals over', () => {
    expect(computeReorder(['a', 'b'], 'a', 'a', 'before')).toEqual(['a', 'b'])
  })

  it('returns original order when overId missing after filter', () => {
    expect(computeReorder(['a', 'b'], 'a', 'x', 'before')).toEqual(['a', 'b'])
  })
})
