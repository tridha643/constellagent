import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractInlineSlashToken, getSkillSuggestions } from '../extensions/inline-skill-autocomplete.js'

const commands = [
  { name: 'skill:caveman', description: 'Ultra-compressed communication mode', source: 'skill' },
  { name: 'skill:tdd', description: 'Test-driven development loop', source: 'skill' },
  { name: 'plan', description: 'Toggle plan mode', source: 'extension' },
  { name: 'review', description: 'Review prompt', source: 'prompt' },
]

describe('extractInlineSlashToken', () => {
  it('ignores command-position slash so pi built-ins keep start-of-input completion', () => {
    assert.equal(extractInlineSlashToken(['/ski'], 0, 4), null)
    assert.equal(extractInlineSlashToken(['   /ski'], 0, 7), null)
  })

  it('matches slash tokens after prompt text on the same line', () => {
    assert.deepEqual(extractInlineSlashToken(['please use /ski'], 0, 15), {
      query: 'ski',
      prefix: '/ski',
      tokenStartCol: 11,
    })
  })

  it('matches slash tokens on later lines after prior prompt text', () => {
    assert.deepEqual(extractInlineSlashToken(['please use', '/td'], 1, 3), {
      query: 'td',
      prefix: '/td',
      tokenStartCol: 0,
    })
  })

  it('does not treat paths or embedded slashes as skill tokens', () => {
    assert.equal(extractInlineSlashToken(['open ./src/'], 0, 11), null)
    assert.equal(extractInlineSlashToken(['open foo/bar'], 0, 12), null)
  })
})

describe('getSkillSuggestions', () => {
  it('returns only skill commands with bare skill labels', () => {
    const items = getSkillSuggestions(commands, '')
    assert.deepEqual(items.map((item) => item.value), ['/skill:caveman', '/skill:tdd'])
    assert.deepEqual(items.map((item) => item.label), ['/caveman', '/tdd'])
  })

  it('filters by bare skill name and description', () => {
    assert.deepEqual(getSkillSuggestions(commands, 'td').map((item) => item.value), ['/skill:tdd'])
    assert.deepEqual(getSkillSuggestions(commands, 'cav').map((item) => item.value), ['/skill:caveman'])
    assert.deepEqual(getSkillSuggestions(commands, 'compressed').map((item) => item.value), ['/skill:caveman'])
  })
})
