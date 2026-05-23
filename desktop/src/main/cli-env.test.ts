import { homedir } from 'os'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import { pathWithStandardCliPrefixes } from './cli-env'

describe('pathWithStandardCliPrefixes', () => {
  test('prepends bun and standard CLI install locations', () => {
    const path = pathWithStandardCliPrefixes()
    const bunBin = join(homedir(), '.bun', 'bin')
    const localBin = join(homedir(), '.local', 'bin')

    expect(path.startsWith(bunBin) || path.includes(`:${bunBin}:`) || path.includes(`${bunBin}:`)).toBe(true)
    expect(path.includes(localBin)).toBe(true)
    expect(path.includes('/opt/homebrew/bin') || path.includes('/usr/local/bin')).toBe(true)
  })
})
