import type { AgentProvider } from '../../shared/agent-chat-types'
import type { ThinkingLevel } from '../../shared/conductor-thinking'
import {
  normalizeConductorDefaultProvider,
  resolveConductorDefaultSelection,
} from '../../shared/conductor-model-utils'
import type { Settings } from '../store/types'
import {
  normalizeLinearIssueConductorModel,
  normalizeLinearIssueConductorProvider,
  normalizeLinearIssueConductorThinkingLevel,
} from '../store/types'

export interface LinearConductorLaunchConfig {
  readonly provider: AgentProvider
  readonly model: string
  readonly thinkingLevel: ThinkingLevel
  readonly plan: boolean
  readonly canvas: boolean
}

/** Resolve effective Conductor session options for a Linear issue launch. */
export function resolveLinearConductorLaunchConfig(settings: Settings): LinearConductorLaunchConfig {
  const plan = settings.linearIssueConductorPlan !== false
  const canvas = settings.linearIssueConductorCanvas === true

  if (settings.linearIssueConductorUseDefaults !== false) {
    const provider = normalizeConductorDefaultProvider(settings.conductorDefaultProvider)
    const { model, thinkingLevel } = resolveConductorDefaultSelection(
      provider,
      settings.conductorDefaultModel,
      settings.conductorDefaultThinkingLevel,
    )
    return { provider, model, thinkingLevel, plan, canvas }
  }

  const provider = normalizeLinearIssueConductorProvider(settings.linearIssueConductorProvider)
  const { model, thinkingLevel } = resolveConductorDefaultSelection(
    provider,
    normalizeLinearIssueConductorModel(settings.linearIssueConductorModel),
    normalizeLinearIssueConductorThinkingLevel(settings.linearIssueConductorThinkingLevel),
  )
  return { provider, model, thinkingLevel, plan, canvas }
}
