import { describe, expect, test } from 'bun:test'
import {
  buildOptionMappings,
  summarizeAskQuestionAnswers,
} from './conductor-ask-question-types'

describe('conductor ask question types', () => {
  test('summarizes answers with option mappings', () => {
    const summary = summarizeAskQuestionAnswers([
      {
        question: 'Which surface?',
        header: 'Scope',
        answer: 'Desktop',
        wasCustom: false,
        selectedOptions: ['Desktop'],
        optionMappings: buildOptionMappings([{ label: 'Desktop' }, { label: 'Web' }]),
      },
    ])

    expect(summary).toContain('Scope: Desktop')
    expect(summary).toContain('A/1=Desktop')
  })
})
