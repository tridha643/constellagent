import { describe, expect, test } from 'bun:test'
import { parseCodexPersonality, upsertCodexPersonalityLine } from './codex-config'

describe('upsertCodexPersonalityLine', () => {
  test('inserts personality at top level in an empty config', () => {
    expect(upsertCodexPersonalityLine('', 'none')).toBe('personality = "none"\n')
  })

  test('replaces an existing top-level personality assignment', () => {
    const config = 'personality = "pragmatic"\n\n[projects."~/dev/foo"]\nmodel = "gpt-5"\n'
    expect(upsertCodexPersonalityLine(config, 'friendly')).toContain('personality = "friendly"')
    expect(upsertCodexPersonalityLine(config, 'friendly')).toContain('[projects."~/dev/foo"]')
    expect(parseCodexPersonality(upsertCodexPersonalityLine(config, 'friendly'))).toBe('friendly')
  })
})
