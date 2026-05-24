import { describe, expect, test } from 'bun:test'
import {
  buildConductorSlashSections,
  firstSentence,
  getConductorHostCommands,
  harnessSkillsToSlashCommands,
  isConductorHostSlashName,
  isHarnessSlashCommand,
  parseActiveSlashToken,
} from './conductor-composer-commands'

describe('parseActiveSlashToken', () => {
  test('detects slash at start', () => {
    expect(parseActiveSlashToken('/pla', 4)).toEqual({ query: '/pla', from: 0, to: 4 })
  })

  test('detects slash after whitespace', () => {
    expect(parseActiveSlashToken('hello /diag', 11)).toEqual({ query: '/diag', from: 6, to: 11 })
  })

  test('rejects path-like slashes', () => {
    expect(parseActiveSlashToken('foo/bar', 7)).toBeNull()
  })

  test('rejects completed tokens with spaces', () => {
    expect(parseActiveSlashToken('/plan mode', 10)).toBeNull()
  })
})

describe('buildConductorSlashSections', () => {
  const hostCommands = getConductorHostCommands({ provider: 'codex', includeFast: true })
  const skills = harnessSkillsToSlashCommands([
    { name: 'caveman', description: 'Brief mode', sourcePath: '/tmp/skills/caveman' },
  ])

  test('orders commands before skills', () => {
    const sections = buildConductorSlashSections('/', hostCommands, skills)
    expect(sections.map((section) => section.id)).toEqual(['commands', 'skills'])
    expect(sections[1]?.title).toBe('Skills')
  })

  test('filters commands by prefix', () => {
    const sections = buildConductorSlashSections('/pla', hostCommands, skills)
    const flat = sections.flatMap((section) => section.items)
    expect(flat.some((item) => item.command === '/plan')).toBe(true)
    expect(flat.some((item) => item.command === '/clear')).toBe(false)
  })

  test('hides personality for cursor provider', () => {
    const cursorCommands = getConductorHostCommands({ provider: 'cursor', includeFast: false })
    expect(cursorCommands.some((command) => command.command === '/personality')).toBe(false)
  })

  test('excludes mcp-status when query is /mcp', () => {
    const hostCommands = getConductorHostCommands({ provider: 'codex', includeFast: true })
    const sections = buildConductorSlashSections('/mcp', hostCommands, [])
    const commands = sections.flatMap((section) => section.items).map((item) => item.command)
    expect(commands).toContain('/mcp')
    expect(commands).not.toContain('/mcp-status')
  })

  test('hides fast when not available', () => {
    const withoutFast = getConductorHostCommands({ provider: 'codex', includeFast: false })
    expect(withoutFast.some((command) => command.command === '/fast')).toBe(false)
  })

  test('hides add-dir and add-file for cursor provider', () => {
    const cursorCommands = getConductorHostCommands({ provider: 'cursor', includeFast: false })
    expect(cursorCommands.some((command) => command.command === '/add-dir')).toBe(false)
    expect(cursorCommands.some((command) => command.command === '/add-file')).toBe(false)
  })
})

describe('firstSentence', () => {
  test('keeps only the first sentence', () => {
    expect(firstSentence('Brief mode. Extra detail here.')).toBe('Brief mode.')
  })

  test('truncates long single-sentence descriptions', () => {
    const long = 'A'.repeat(140)
    expect(firstSentence(long).endsWith('…')).toBe(true)
  })
})

describe('isConductorHostSlashName', () => {
  test('recognizes built-in host commands', () => {
    expect(isConductorHostSlashName('plan')).toBe(true)
    expect(isConductorHostSlashName('mcp-status')).toBe(true)
  })

  test('rejects harness skill names', () => {
    expect(isConductorHostSlashName('triage')).toBe(false)
    expect(isConductorHostSlashName('caveman')).toBe(false)
  })
})

describe('isHarnessSlashCommand', () => {
  test('accepts slash commands with arguments', () => {
    expect(isHarnessSlashCommand('/add-dir src/lib')).toBe(true)
    expect(isHarnessSlashCommand('/compact')).toBe(true)
  })

  test('rejects skill-like slash text so it can render as a chat chip', () => {
    expect(isHarnessSlashCommand('/caveman')).toBe(false)
    expect(isHarnessSlashCommand('/caveman please be terse')).toBe(false)
  })

  test('rejects multiline input', () => {
    expect(isHarnessSlashCommand('/compact\nmore')).toBe(false)
  })
})
