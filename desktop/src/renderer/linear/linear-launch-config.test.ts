import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../store/types'
import { resolveLinearConductorLaunchConfig } from './linear-launch-config'

describe('resolveLinearConductorLaunchConfig', () => {
  it('uses global Conductor defaults when linearIssueConductorUseDefaults is true', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      linearIssueConductorUseDefaults: true,
      conductorDefaultProvider: 'codex',
      conductorDefaultModel: 'gpt-5.4-mini',
      conductorDefaultThinkingLevel: 'high',
      linearIssueConductorProvider: 'cursor',
      linearIssueConductorModel: 'composer-2',
      linearIssueConductorThinkingLevel: 'low',
    }

    expect(resolveLinearConductorLaunchConfig(settings)).toEqual({
      provider: 'codex',
      model: 'gpt-5.4-mini',
      thinkingLevel: 'high',
      plan: true,
      canvas: false,
    })
  })

  it('uses Linear-specific overrides when useDefaults is false', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      linearIssueConductorUseDefaults: false,
      linearIssueConductorProvider: 'cursor',
      linearIssueConductorModel: 'composer-2-fast',
      linearIssueConductorThinkingLevel: 'xhigh',
      linearIssueConductorPlan: false,
      linearIssueConductorCanvas: true,
      conductorDefaultProvider: 'codex',
      conductorDefaultModel: 'gpt-5.4-mini',
    }

    expect(resolveLinearConductorLaunchConfig(settings)).toEqual({
      provider: 'cursor',
      model: 'composer-2-fast',
      thinkingLevel: 'xhigh',
      plan: false,
      canvas: true,
    })
  })

  it('falls back to provider default model when override model is empty', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      linearIssueConductorUseDefaults: false,
      linearIssueConductorProvider: 'codex',
      linearIssueConductorModel: '',
      linearIssueConductorThinkingLevel: 'medium',
    }

    const config = resolveLinearConductorLaunchConfig(settings)
    expect(config.provider).toBe('codex')
    expect(config.model).toBeTruthy()
    expect(config.thinkingLevel).toBe('medium')
  })
})
