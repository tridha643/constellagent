import { describe, expect, test } from 'bun:test'
import {
  atMentionFileName,
  atMentionParentDir,
  atMentionSearchQuery,
  formatAtMentionInsert,
  hasComposerDraftInput,
  parseActiveAtToken,
  serializeComposerTextWithFileMentions,
  shouldBackspaceRemoveLastFileMention,
} from './composer-at-mention'

describe('parseActiveAtToken', () => {
  test('detects at at start', () => {
    expect(parseActiveAtToken('@src', 4)).toEqual({ query: '@src', from: 0, to: 4 })
  })

  test('detects at after whitespace', () => {
    expect(parseActiveAtToken('see @src/foo.ts', 15)).toEqual({ query: '@src/foo.ts', from: 4, to: 15 })
  })

  test('rejects at inside words', () => {
    expect(parseActiveAtToken('foo@bar', 7)).toBeNull()
  })

  test('rejects at with spaces in segment', () => {
    expect(parseActiveAtToken('@src foo', 8)).toBeNull()
  })
})

describe('atMentionSearchQuery', () => {
  test('strips leading at', () => {
    expect(atMentionSearchQuery('@src/foo')).toBe('src/foo')
    expect(atMentionSearchQuery('@')).toBe('')
  })
})

describe('formatAtMentionInsert', () => {
  test('inserts relative path with trailing space', () => {
    expect(formatAtMentionInsert({ relativePath: 'src/App.tsx' })).toBe('@src/App.tsx ')
  })
})

describe('atMentionParentDir', () => {
  test('returns parent directory with trailing slash', () => {
    expect(atMentionParentDir('desktop/src/App.tsx')).toBe('desktop/src/')
    expect(atMentionParentDir('README.md')).toBe('')
  })
})

describe('atMentionFileName', () => {
  test('returns basename', () => {
    expect(atMentionFileName('desktop/src/App.tsx')).toBe('App.tsx')
    expect(atMentionFileName('README.md')).toBe('README.md')
  })
})

describe('serializeComposerTextWithFileMentions', () => {
  test('joins text and mentions', () => {
    expect(
      serializeComposerTextWithFileMentions('fix this', [
        { id: '1', relativePath: 'src/App.tsx', absolutePath: '/tmp/src/App.tsx' },
      ]),
    ).toBe('fix this @src/App.tsx')
  })

  test('returns mentions only when text is empty', () => {
    expect(
      serializeComposerTextWithFileMentions('', [
        { id: '1', relativePath: 'src/App.tsx', absolutePath: '/tmp/src/App.tsx' },
      ]),
    ).toBe('@src/App.tsx')
  })
})

describe('hasComposerDraftInput', () => {
  test('detects non-empty trimmed text', () => {
    expect(hasComposerDraftInput('@src/App.tsx')).toBe(true)
    expect(hasComposerDraftInput('   ')).toBe(false)
  })
})

describe('shouldBackspaceRemoveLastFileMention', () => {
  test('removes last chip when caret is at draft start', () => {
    expect(shouldBackspaceRemoveLastFileMention(0, 0, 2)).toBe(true)
  })

  test('does not remove chip when caret is after text', () => {
    expect(shouldBackspaceRemoveLastFileMention(3, 3, 1)).toBe(false)
  })

  test('does not remove chip when selection spans text', () => {
    expect(shouldBackspaceRemoveLastFileMention(0, 2, 1)).toBe(false)
  })
})
