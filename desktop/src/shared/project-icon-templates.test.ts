import { describe, expect, it } from 'bun:test'
import {
  PROJECT_ICON_GLYPHS,
  PROJECT_ICON_COLORS,
  DEFAULT_PROJECT_ICON_GLYPH,
  DEFAULT_PROJECT_ICON_COLOR,
  isProjectIconGlyph,
  isProjectIconColor,
} from './project-icon-templates'

describe('project-icon-templates catalog integrity', () => {
  it('has non-empty glyph and color catalogs', () => {
    expect(PROJECT_ICON_GLYPHS.length).toBeGreaterThan(0)
    expect(PROJECT_ICON_COLORS.length).toBeGreaterThan(0)
  })

  it('has unique glyph ids', () => {
    const ids = PROJECT_ICON_GLYPHS.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has unique color ids and var values', () => {
    const ids = PROJECT_ICON_COLORS.map((c) => c.id)
    const vars = PROJECT_ICON_COLORS.map((c) => c.var)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(vars).size).toBe(vars.length)
  })

  it('color vars reference theme accent custom properties', () => {
    for (const color of PROJECT_ICON_COLORS) {
      expect(color.var).toMatch(/^var\(--accent-[a-z]+\)$/)
    }
  })

  it('defaults resolve against the catalogs', () => {
    expect(isProjectIconGlyph(DEFAULT_PROJECT_ICON_GLYPH)).toBe(true)
    expect(isProjectIconColor(DEFAULT_PROJECT_ICON_COLOR)).toBe(true)
  })

  it('membership helpers reject unknown values', () => {
    expect(isProjectIconGlyph('not-a-real-glyph')).toBe(false)
    expect(isProjectIconColor('var(--accent-chartreuse)')).toBe(false)
  })
})
