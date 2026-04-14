import test from 'node:test'
import assert from 'node:assert/strict'
import registerAskUserQuestion, { formatAskUserQuestionDetails, summarizeAskUserQuestionAnswers, type AskUserQuestionAnswer, type AskUserQuestionDetails } from '../extensions/ask-user-question.js'

class FakeAPI {
  tools: any[] = []

  registerTool(tool: any): void {
    this.tools.push(tool)
  }
}

async function createInteractiveHarness(params: {
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description?: string }>
    multiSelect?: boolean
  }>
}) {
  const api = new FakeAPI()
  registerAskUserQuestion(api as any)
  const tool = api.tools.find((candidate) => candidate.name === 'askUserQuestion')
  assert.ok(tool)

  let component: { handleInput: (data: string) => void; render: (width: number) => string[] } | null = null
  let resolveDone: ((value: AskUserQuestionDetails) => void) | null = null
  const detailsPromise = new Promise<AskUserQuestionDetails>((resolve) => {
    resolveDone = resolve
  })

  const ctx = {
    hasUI: true,
    ui: {
      custom: async (factory: any) => {
        component = factory(
          { requestRender: () => {} },
          {
            fg: (_name: string, text: string) => text,
            bg: (_name: string, text: string) => text,
            bold: (text: string) => text,
          },
          {},
          (details: AskUserQuestionDetails) => resolveDone?.(details),
        )
        return detailsPromise
      },
    },
  }

  const executePromise = tool.execute('tool-call-id', params, new AbortController().signal, () => {}, ctx)
  await Promise.resolve()
  assert.ok(component)

  return {
    send: (data: string) => component!.handleInput(data),
    render: (width = 120) => component!.render(width).join('\n'),
    result: executePromise,
  }
}

test('summarizeAskUserQuestionAnswers merges single-select choice and extra details', () => {
  const answers: AskUserQuestionAnswer[] = [
    {
      question: 'Q?',
      header: 'Scope',
      answer: 'Hardening',
      wasCustom: false,
      selectedOptions: ['Hardening'],
      details: 'Focus on auth first.',
    },
  ]
  assert.equal(summarizeAskUserQuestionAnswers(answers), 'Scope: Hardening — Focus on auth first.')
})

test('summarizeAskUserQuestionAnswers merges multi-select choices and extra details', () => {
  const answers: AskUserQuestionAnswer[] = [
    {
      question: 'Q?',
      header: 'Stack',
      answer: ['API', 'UI'],
      wasCustom: false,
      selectedOptions: ['API', 'UI'],
      details: 'Ship API before UI.',
    },
  ]
  assert.equal(summarizeAskUserQuestionAnswers(answers), 'Stack: API, UI — Ship API before UI.')
})

test('custom-only answers omit preset selections and serialize without details suffix when absent', () => {
  const answers: AskUserQuestionAnswer[] = [
    {
      question: 'Q?',
      header: 'Note',
      answer: 'Fully custom response',
      wasCustom: true,
      selectedOptions: [],
    },
  ]
  assert.equal(summarizeAskUserQuestionAnswers(answers), 'Note: Fully custom response')
})

test('summarizeAskUserQuestionAnswers preserves multiline details as-is', () => {
  const answers: AskUserQuestionAnswer[] = [
    {
      question: 'Q?',
      header: 'Notes',
      answer: 'Use current layout',
      wasCustom: false,
      selectedOptions: ['Use current layout'],
      details: 'Match the hero spacing.\nKeep the footer unchanged.',
    },
  ]
  assert.equal(
    summarizeAskUserQuestionAnswers(answers),
    'Notes: Use current layout — Match the hero spacing.\nKeep the footer unchanged.',
  )
})

test('formatAskUserQuestionDetails returns null when cancelled', () => {
  assert.equal(formatAskUserQuestionDetails({ cancelled: true, answers: [] }), null)
})

test('formatAskUserQuestionDetails joins multiple questions with newlines', () => {
  const text = formatAskUserQuestionDetails({
    cancelled: false,
    answers: [
      {
        question: 'A?',
        header: 'A',
        answer: 'One',
        wasCustom: false,
        selectedOptions: ['One'],
        details: 'alpha',
      },
      {
        question: 'B?',
        header: 'B',
        answer: ['X', 'Y'],
        wasCustom: false,
        selectedOptions: ['X', 'Y'],
      },
    ],
  })
  assert.equal(text, 'A: One — alpha\nB: X, Y')
})

test('askUserQuestion prompt guidance reflects batched clarification behavior', () => {
  const api = new FakeAPI()
  registerAskUserQuestion(api as any)
  const tool = api.tools.find((candidate) => candidate.name === 'askUserQuestion')
  assert.ok(tool)
  assert.match(tool.promptSnippet, /initial batch of 3-4 strong questions/i)
  assert.ok(Array.isArray(tool.promptGuidelines))
  assert.ok(tool.promptGuidelines.some((line: string) => /deeper repo investigation/i.test(line)))
})

test('askUserQuestion accepts raw space for multi-select toggles and submits from review', async () => {
  const harness = await createInteractiveHarness({
    questions: [
      {
        header: 'Stack',
        question: 'Which areas should this plan cover?',
        multiSelect: true,
        options: [
          { label: 'API', description: 'Backend work first.' },
          { label: 'UI', description: 'Frontend work too.' },
        ],
      },
    ],
  })

  harness.send(' ')
  assert.match(harness.render(), /\[x\] API/)
  assert.doesNotMatch(harness.render(), /Review your answers/)

  harness.send('\t')
  harness.send('\r')

  const result = await harness.result
  assert.equal(result.details.cancelled, false)
  assert.deepEqual(result.details.answers, [
    {
      question: 'Which areas should this plan cover?',
      header: 'Stack',
      answer: ['API'],
      wasCustom: false,
      selectedOptions: ['API'],
    },
  ])
})

test('askUserQuestion keeps multi-select enter as a toggle until review submit', async () => {
  const harness = await createInteractiveHarness({
    questions: [
      {
        header: 'Stack',
        question: 'Which areas should this plan cover?',
        multiSelect: true,
        options: [
          { label: 'API', description: 'Backend work first.' },
          { label: 'UI', description: 'Frontend work too.' },
        ],
      },
    ],
  })

  harness.send('\r')
  const questionView = harness.render()
  assert.match(questionView, /\[x\] API/)
  assert.match(questionView, /Which areas should this plan cover\?/)
  assert.doesNotMatch(questionView, /Review your answers/)

  harness.send('\t')
  harness.send('\r')

  const result = await harness.result
  assert.equal(result.details.cancelled, false)
  assert.deepEqual(result.details.answers[0]?.selectedOptions, ['API'])
})

test('askUserQuestion headless mode auto-selects when PI_CONSTELL_HEADLESS_CLARIFICATION=1 and hasUI is false', async () => {
  const prev = process.env.PI_CONSTELL_HEADLESS_CLARIFICATION
  process.env.PI_CONSTELL_HEADLESS_CLARIFICATION = '1'
  try {
    let completed: AskUserQuestionDetails | undefined
    const api = new FakeAPI()
    registerAskUserQuestion(api as any, {
      onComplete: async (d) => {
        completed = d
      },
    })
    const tool = api.tools.find((candidate) => candidate.name === 'askUserQuestion')
    assert.ok(tool)
    const ctx = { hasUI: false, ui: {} }
    const result = await tool.execute(
      'tc',
      {
        questions: [
          {
            question: 'Pick one',
            header: 'Scope',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      },
      undefined,
      () => {},
      ctx as any,
    )
    assert.equal(result.details.cancelled, false)
    assert.equal((result.details as AskUserQuestionDetails).answers[0]?.answer, 'A')
    assert.ok(completed)
    assert.equal(completed.cancelled, false)
  } finally {
    if (prev === undefined) delete process.env.PI_CONSTELL_HEADLESS_CLARIFICATION
    else process.env.PI_CONSTELL_HEADLESS_CLARIFICATION = prev
  }
})
