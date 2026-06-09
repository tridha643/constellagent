import { describe, expect, it } from 'bun:test'
import { parsePorcelainStatusV1Z } from './git-service'

describe('parsePorcelainStatusV1Z', () => {
  it('parses paths with spaces without git quotePath wrapping', () => {
    const entries = parsePorcelainStatusV1Z(' D John . Txt\0 M foo.txt\0')

    expect(entries).toEqual([
      { indexStatus: ' ', workStatus: 'D', path: 'John . Txt' },
      { indexStatus: ' ', workStatus: 'M', path: 'foo.txt' },
    ])
  })

  it('parses untracked rows', () => {
    const entries = parsePorcelainStatusV1Z('?? bar baz.txt\0')

    expect(entries).toEqual([
      { indexStatus: '?', workStatus: '?', path: 'bar baz.txt' },
    ])
  })

  it('parses rename rows using the destination path', () => {
    const entries = parsePorcelainStatusV1Z('R  old name.txt\0new name.txt\0')

    expect(entries).toEqual([
      { indexStatus: 'R', workStatus: ' ', path: 'new name.txt' },
    ])
  })

  it('parses staged and unstaged rows from one MM entry', () => {
    const entries = parsePorcelainStatusV1Z('MM src/file.ts\0')

    expect(entries).toEqual([
      { indexStatus: 'M', workStatus: 'M', path: 'src/file.ts' },
    ])
  })
})
