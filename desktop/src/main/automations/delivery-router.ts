import type { ComposioAutomationDefinition } from '../../shared/composio-types'
import { composioDeliveryFromPayload, type AutomationDelivery } from './delivery-types'
import { listComposioAutomationDefinitions } from './composio-definition-store'
import { AutomationRunner } from './automation-runner'

function sameToken(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function definitionMatchesDelivery(definition: ComposioAutomationDefinition, delivery: AutomationDelivery): boolean {
  if (!definition.enabled) return false
  if (definition.triggerId && delivery.triggerIds.some((id) => sameToken(id, definition.triggerId))) return true
  if (definition.triggerSlug && delivery.triggerSlugs.some((slug) => sameToken(slug, definition.triggerSlug))) return true
  return false
}

export class AutomationDeliveryRouter {
  constructor(private readonly runner: AutomationRunner) {}

  async handleComposioPayload(payload: unknown): Promise<number> {
    const delivery = composioDeliveryFromPayload(payload)
    const definitions = await listComposioAutomationDefinitions()
    const matches = definitions.filter((definition) => definitionMatchesDelivery(definition, delivery))

    for (const definition of matches) {
      try {
        await this.runner.runComposioDefinition(definition, payload)
      } catch (err) {
        console.error('[automation-router] composio automation failed to start', {
          id: definition.id,
          name: definition.name,
          err,
        })
      }
    }

    return matches.length
  }
}
