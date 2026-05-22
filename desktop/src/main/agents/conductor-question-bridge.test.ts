import { describe, expect, test } from 'bun:test'
import { ConductorQuestionBridge } from './conductor-question-bridge'

describe('ConductorQuestionBridge', () => {
  test('resolves pending question with answers', async () => {
    const bridge = new ConductorQuestionBridge()

    const seen: string[] = []
    bridge.setHostNotifier((question) => {
      seen.push(question.requestId)
    })

    const pending = bridge.registerPending({
      sessionId: 'session-1',
      callId: 'call-1',
      provider: 'cursor',
      source: 'askQuestion',
      questions: [
        {
          header: 'Scope',
          question: 'Which surface?',
          options: [{ label: 'Desktop' }, { label: 'Mobile' }],
        },
      ],
    })

    expect(seen).toHaveLength(1)
    bridge.resolve(seen[0]!, {
      cancelled: false,
      answers: [
        {
          question: 'Which surface?',
          header: 'Scope',
          answer: 'Desktop',
          wasCustom: false,
          selectedOptions: ['Desktop'],
        },
      ],
    })

    const details = await pending
    expect(details.cancelled).toBe(false)
    expect(details.answers[0]?.answer).toBe('Desktop')
    bridge.dispose()
  })

  test('rejects pending question on cancel', async () => {
    const bridge = new ConductorQuestionBridge()

    const pending = bridge.registerPending({
      sessionId: 'session-2',
      callId: 'call-2',
      provider: 'cursor',
      source: 'askQuestion',
      questions: [
        {
          header: 'Plan',
          question: 'Proceed?',
          options: [{ label: 'Yes' }],
        },
      ],
    })

    bridge.rejectAll('User cancelled')
    await expect(pending).rejects.toThrow('User cancelled')
    bridge.dispose()
  })
})
