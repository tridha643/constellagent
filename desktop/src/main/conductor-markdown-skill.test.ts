import { describe, expect, it } from 'bun:test'
import { conductorMarkdownSkillId, syncConductorMarkdownSkill } from './conductor-markdown-skill'

describe('conductor-markdown-skill', () => {
  it('syncConductorMarkdownSkill is exported', () => {
    expect(typeof syncConductorMarkdownSkill).toBe('function')
  })

  it('maps cursor and codex to bundled skill ids', () => {
    expect(conductorMarkdownSkillId('cursor')).toBe('conductor-markdown-cursor')
    expect(conductorMarkdownSkillId('codex')).toBe('conductor-markdown-codex')
    expect(conductorMarkdownSkillId('claude')).toBeUndefined()
  })
})
