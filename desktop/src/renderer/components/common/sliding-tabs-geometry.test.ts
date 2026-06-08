import { describe, expect, it } from 'bun:test'
import { indicatorMetrics, type TabBox } from './sliding-tabs-geometry'

const boxes: TabBox[] = [
  { offsetLeft: 0, offsetWidth: 80 },
  { offsetLeft: 80, offsetWidth: 120 },
  { offsetLeft: 200, offsetWidth: 60 },
]

describe('indicatorMetrics', () => {
  it('points at the first tab', () => {
    expect(indicatorMetrics(boxes, 0)).toEqual({ x: 0, width: 80 })
  })

  it('points at a middle tab', () => {
    expect(indicatorMetrics(boxes, 1)).toEqual({ x: 80, width: 120 })
  })

  it('points at the last tab', () => {
    expect(indicatorMetrics(boxes, 2)).toEqual({ x: 200, width: 60 })
  })

  it('returns null when the active index is out of range', () => {
    expect(indicatorMetrics(boxes, -1)).toBeNull()
    expect(indicatorMetrics(boxes, 3)).toBeNull()
  })

  it('returns null for an empty tab set', () => {
    expect(indicatorMetrics([], 0)).toBeNull()
  })

  it('coerces non-finite / negative measurements to safe values', () => {
    expect(
      indicatorMetrics([{ offsetLeft: Number.NaN, offsetWidth: -10 }], 0),
    ).toEqual({ x: 0, width: 0 })
  })
})
