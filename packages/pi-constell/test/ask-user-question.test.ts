import test from 'node:test'
import assert from 'node:assert/strict'
import { formatAskUserQuestionDetails, summarizeAskUserQuestionAnswers, type AskUserQuestionAnswer } from '../extensions/ask-user-question.js'

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
