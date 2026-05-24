import { describe, expect, it } from 'bun:test'
import { isConductorHostSlashName } from './conductor-composer-commands'
import {
  findMarkdownSkillSlashReferences,
  isLikelySkillIdentifier,
  isSkillLoadToolName,
  skillDisplayFromToolInput,
} from './skill-tool-utils'

describe('skill-tool-utils', () => {
  it('recognizes native skill tool names', () => {
    expect(isSkillLoadToolName('Skill')).toBe(true)
    expect(isSkillLoadToolName('load_skill')).toBe(true)
    expect(isSkillLoadToolName('conductor.load_skill')).toBe(true)
    expect(isSkillLoadToolName('read')).toBe(false)
  })

  it('detects inline skill identifiers in markdown code spans', () => {
    expect(isLikelySkillIdentifier('composio-cli')).toBe(true)
    expect(isLikelySkillIdentifier('caveman')).toBe(true)
    expect(isLikelySkillIdentifier('foo.ts')).toBe(false)
    expect(isLikelySkillIdentifier('src/foo.ts')).toBe(false)
    expect(isLikelySkillIdentifier('$ npm test')).toBe(false)
    expect(isConductorHostSlashName('compact')).toBe(true)
    expect(isLikelySkillIdentifier('compact')).toBe(false)
  })

  it('finds bare skill slash references in prose', () => {
    const refs = findMarkdownSkillSlashReferences('Try /composio-cli next.')
    expect(refs).toEqual([{ from: 4, to: 17, name: 'composio-cli' }])
  })

  it('extracts skill label from tool input', () => {
    expect(skillDisplayFromToolInput({ skill: 'emil-design-eng' })).toEqual({
      label: 'Emil Design Eng',
      skillId: 'emil-design-eng',
    })
    expect(skillDisplayFromToolInput('hunk-review')).toEqual({
      label: 'Hunk Review',
      skillId: 'hunk-review',
    })
  })
})
