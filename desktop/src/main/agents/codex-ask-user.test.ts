import { describe, expect, test } from 'bun:test'
import {
  formatCodexAskUserContinuation,
  parseCodexAskUserToolRequest,
} from './codex-ask-user'

describe('Codex request_user_input tool support', () => {
  test('parses native request_user_input tool object arguments', () => {
    const parsed = parseCodexAskUserToolRequest({
      questions: [
        {
          header: 'Choice',
          question: 'Which option?',
          options: [
            { label: 'A', description: 'First path.' },
            { label: 'B', description: 'Second path.' },
          ],
        },
      ],
    })

    expect(parsed?.questions).toEqual([
      {
        header: 'Choice',
        question: 'Which option?',
        options: [
          { label: 'A', description: 'First path.' },
          { label: 'B', description: 'Second path.' },
        ],
      },
    ])
  })

  test('parses native request_user_input tool JSON-string arguments', () => {
    const parsed = parseCodexAskUserToolRequest(
      JSON.stringify({
        questions: [
          {
            header: 'Scope',
            question: 'Which implementation path should I take?',
            options: [{ label: 'Minimal' }, { label: 'Broad' }],
          },
        ],
      }),
    )

    expect(parsed?.questions[0]?.question).toBe('Which implementation path should I take?')
  })

  test('rejects requests with too few options', () => {
    const parsed = parseCodexAskUserToolRequest({
      questions: [{ header: 'Scope', question: 'Which path?', options: [{ label: 'Only' }] }],
    })

    expect(parsed).toBeNull()
  })

  test('formats answer details as a Codex continuation message', () => {
    expect(
      formatCodexAskUserContinuation({
        cancelled: false,
        answers: [
          {
            header: 'Scope',
            question: 'Which path?',
            answer: 'A',
            wasCustom: false,
            selectedOptions: ['A'],
          },
        ],
      }),
    ).toContain('<conductor-user-input-response>\nScope: A')
  })

  test('cancelled answers do not produce a continuation', () => {
    expect(formatCodexAskUserContinuation({ cancelled: true, answers: [] })).toBeNull()
  })
})
