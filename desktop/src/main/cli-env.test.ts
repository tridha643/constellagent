import { homedir } from 'os'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import { pathWithStandardCliPrefixes, stripNodeModulesBin } from './cli-env'

describe('pathWithStandardCliPrefixes', () => {
  test('prepends bun and standard CLI install locations', () => {
    const path = pathWithStandardCliPrefixes()
    const bunBin = join(homedir(), '.bun', 'bin')
    const localBin = join(homedir(), '.local', 'bin')

    expect(path.startsWith(bunBin) || path.includes(`:${bunBin}:`) || path.includes(`${bunBin}:`)).toBe(true)
    expect(path.includes(localBin)).toBe(true)
    expect(path.includes('/opt/homebrew/bin') || path.includes('/usr/local/bin')).toBe(true)
  })

  test('drops node_modules/.bin entries leaked into process.env.PATH', () => {
    const original = process.env.PATH
    process.env.PATH = '/Users/me/app/desktop/node_modules/.bin:/opt/homebrew/bin:/usr/bin'
    try {
      const path = pathWithStandardCliPrefixes()
      expect(path.includes('node_modules/.bin')).toBe(false)
      expect(path.includes('/usr/bin')).toBe(true)
    } finally {
      process.env.PATH = original
    }
  })
})

describe('stripNodeModulesBin', () => {
  test('removes node_modules/.bin entries, with or without a trailing slash', () => {
    const input = ['/a/node_modules/.bin', '/b/node_modules/.bin/', '/opt/homebrew/bin', '/usr/bin'].join(':')
    expect(stripNodeModulesBin(input)).toBe('/opt/homebrew/bin:/usr/bin')
  })

  test('keeps unrelated entries that merely contain node_modules', () => {
    const input = ['/proj/node_modules/.cache/bin', '/usr/local/bin'].join(':')
    expect(stripNodeModulesBin(input)).toBe(input)
  })

  test('is a no-op on a clean PATH', () => {
    const input = '/opt/homebrew/bin:/usr/bin:/bin'
    expect(stripNodeModulesBin(input)).toBe(input)
  })
})
