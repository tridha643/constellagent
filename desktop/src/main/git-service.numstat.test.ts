import { describe, expect, it } from 'bun:test'
import { parseGitNumstat } from './git-service'

describe('parseGitNumstat', () => {
  it('parses normal numstat rows keyed by path', () => {
    const stats = parseGitNumstat('3\t4\tsrc/file.ts\0')

    expect(stats.get('src/file.ts')).toEqual({ additions: 3, deletions: 4 })
  })

  it('keys rename rows by destination path', () => {
    const stats = parseGitNumstat('1\t0\t\0old name.ts\0new name.ts\0')

    expect(stats.has('old name.ts')).toBe(false)
    expect(stats.get('new name.ts')).toEqual({ additions: 1, deletions: 0 })
  })

  it('aggregates repeated paths and ignores binary rows', () => {
    const stats = parseGitNumstat([
      '2\t1\tsrc/file.ts',
      '5\t3\tsrc/file.ts',
      '-\t-\tassets/logo.png',
      '',
    ].join('\0'))

    expect(stats.get('src/file.ts')).toEqual({ additions: 7, deletions: 4 })
    expect(stats.has('assets/logo.png')).toBe(false)
  })
})
