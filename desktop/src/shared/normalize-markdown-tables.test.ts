import { describe, expect, test } from 'bun:test'
import { normalizeMarkdownTables, parseMarkdownTableCells } from './normalize-markdown-tables'

describe('parseMarkdownTableCells', () => {
  test('parses header row', () => {
    expect(parseMarkdownTableCells('| Area | MVP | Later |')).toEqual(['Area', 'MVP', 'Later'])
  })
})

describe('normalizeMarkdownTables', () => {
  test('expands single-cell --- delimiter to match header columns', () => {
    const input = `| Area | MVP | Later |
|---|
| Run listing | Recent | Saved |`
    const out = normalizeMarkdownTables(input)
    expect(out).toContain('| --- | --- | --- |')
    expect(out).not.toContain('\n|---|\n')
  })

  test('leaves valid tables unchanged', () => {
    const input = `| A | B |
|---|---|
| 1 | 2 |`
    expect(normalizeMarkdownTables(input)).toBe(input)
  })
})
