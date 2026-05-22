import { describe, expect, test } from 'bun:test'
import { normalizeCursorAskQuestions } from './cursor-interaction-bridge'

describe('normalizeCursorAskQuestions', () => {
  test('maps Cursor AskQuestion args into Conductor prompts', () => {
    const prompts = normalizeCursorAskQuestions({
      title: 'Planning',
      questions: [
        {
          id: 'Surface',
          prompt: 'Where should this ship first?',
          allow_multiple: false,
          options: [
            { id: '1', label: 'Desktop', description: 'Electron app' },
            { id: '2', label: 'Web' },
          ],
        },
      ],
    })

    expect(prompts).toHaveLength(1)
    expect(prompts[0]?.header).toBe('Surface')
    expect(prompts[0]?.question).toBe('Where should this ship first?')
    expect(prompts[0]?.options[0]?.description).toBe('Electron app')
  })
})
