import { describe, expect, it } from 'bun:test'
import { isSkillLoadToolName, skillDisplayFromToolInput } from './skill-tool-utils'

describe('skill-tool-utils', () => {
  it('recognizes native skill tool names', () => {
    expect(isSkillLoadToolName('Skill')).toBe(true)
    expect(isSkillLoadToolName('load_skill')).toBe(true)
    expect(isSkillLoadToolName('conductor.load_skill')).toBe(true)
    expect(isSkillLoadToolName('read')).toBe(false)
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
