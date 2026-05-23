import { describe, expect, it } from 'bun:test'
import { syncConductorCanvasSkill, conductorCanvasSkillId } from './conductor-canvas-skill'

describe('conductor-canvas-skill', () => {
  it('maps providers to bundled skill ids', () => {
    expect(conductorCanvasSkillId('codex')).toBe('conductor-canvas-codex')
    expect(conductorCanvasSkillId('cursor')).toBe('conductor-canvas-cursor')
  })

  it('syncConductorCanvasSkill is exported', () => {
    expect(typeof syncConductorCanvasSkill).toBe('function')
  })
})
