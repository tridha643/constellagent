import { EventEmitter } from 'events'
import type { AutomationEvent } from '../shared/automation-types'

type AutomationEventHandler = (event: AutomationEvent) => void

const emitter = new EventEmitter()

export function emitAutomationEvent(event: AutomationEvent): void {
  emitter.emit('automation-event', event)
}

export function onAutomationEvent(handler: AutomationEventHandler): () => void {
  emitter.on('automation-event', handler)
  return () => {
    emitter.off('automation-event', handler)
  }
}

