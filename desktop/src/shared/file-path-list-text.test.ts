import { describe, expect, test } from 'bun:test'
import { fenceLangAllowsFilePathList, parseFilePathListText } from './file-path-list-text'

describe('parseFilePathListText', () => {
  test('accepts multi-line repo paths', () => {
    const text = `desktop/e2e/conductor-ask-question.spec.ts
desktop/skills/conductor-canvas-codex/SKILL.md
packages/review-annotations/README.md`
    expect(parseFilePathListText(text)).toEqual([
      'desktop/e2e/conductor-ask-question.spec.ts',
      'desktop/skills/conductor-canvas-codex/SKILL.md',
      'packages/review-annotations/README.md',
    ])
  })

  test('rejects single line', () => {
    expect(parseFilePathListText('desktop/foo.ts')).toBeNull()
  })

  test('rejects mixed content', () => {
    expect(parseFilePathListText('desktop/foo.ts\nconst x = 1;')).toBeNull()
  })
})

describe('fenceLangAllowsFilePathList', () => {
  test('allows empty and path-friendly langs', () => {
    expect(fenceLangAllowsFilePathList(undefined)).toBe(true)
    expect(fenceLangAllowsFilePathList('paths')).toBe(true)
  })

  test('blocks code langs', () => {
    expect(fenceLangAllowsFilePathList('typescript')).toBe(false)
    expect(fenceLangAllowsFilePathList('mermaid')).toBe(false)
  })
})
