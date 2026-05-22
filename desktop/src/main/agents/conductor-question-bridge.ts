import { randomUUID } from 'node:crypto'
import type {
  ConductorAskQuestionDetails,
  ConductorBlockingQuestion,
  ConductorBlockingQuestionProvider,
  ConductorBlockingQuestionSource,
  ConductorAskQuestionPrompt,
} from '../../shared/conductor-ask-question-types'

interface PendingQuestion {
  readonly meta: ConductorBlockingQuestion
  readonly resolve: (details: ConductorAskQuestionDetails) => void
  readonly reject: (reason: Error) => void
}

export type ConductorQuestionHostNotifier = (question: ConductorBlockingQuestion) => void

/** In-process blocking bridge for Cursor plan-mode AskQuestion. */
export class ConductorQuestionBridge {
  private readonly pending = new Map<string, PendingQuestion>()
  private hostNotifier: ConductorQuestionHostNotifier | null = null

  setHostNotifier(notifier: ConductorQuestionHostNotifier | null): void {
    this.hostNotifier = notifier
  }

  registerPending(input: {
    sessionId: string
    callId: string
    provider: ConductorBlockingQuestionProvider
    source: ConductorBlockingQuestionSource
    questions: readonly ConductorAskQuestionPrompt[]
  }): Promise<ConductorAskQuestionDetails> {
    const requestId = randomUUID()
    const meta: ConductorBlockingQuestion = {
      requestId,
      sessionId: input.sessionId,
      callId: input.callId,
      provider: input.provider,
      source: input.source,
      questions: input.questions,
      createdAt: new Date().toISOString(),
    }

    return new Promise<ConductorAskQuestionDetails>((resolve, reject) => {
      this.pending.set(requestId, { meta, resolve, reject })
      this.hostNotifier?.(meta)
    })
  }

  resolve(requestId: string, details: ConductorAskQuestionDetails): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    pending.resolve(details)
  }

  reject(requestId: string, reason: string): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    pending.reject(new Error(reason))
  }

  rejectAll(reason: string): void {
    for (const [requestId] of this.pending) {
      this.reject(requestId, reason)
    }
  }

  dispose(): void {
    this.rejectAll('Conductor question bridge disposed')
  }
}

let bridge: ConductorQuestionBridge | null = null

export function getConductorQuestionBridge(): ConductorQuestionBridge {
  if (!bridge) bridge = new ConductorQuestionBridge()
  return bridge
}
