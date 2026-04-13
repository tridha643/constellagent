import test from 'node:test'
import assert from 'node:assert/strict'
import { extractImagePaths, formatAskUserQuestionDetails, summarizeAskUserQuestionAnswers, type AskUserQuestionAnswer } from '../extensions/ask-user-question.js'

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

test('extractImagePaths finds path-based image references in details text', () => {
  assert.deepEqual(
    extractImagePaths('See mockup below\nScreenshot: /tmp/constellagent-paste-123.png\n./artifacts/wireframe.webp'),
    ['/tmp/constellagent-paste-123.png', './artifacts/wireframe.webp'],
  )
})

test('summarizeAskUserQuestionAnswers surfaces image paths separately from free-text details', () => {
  const answers: AskUserQuestionAnswer[] = [
    {
      question: 'Q?',
      header: 'Visuals',
      answer: 'Use current layout',
      wasCustom: false,
      selectedOptions: ['Use current layout'],
      details: 'Match the hero spacing.\nScreenshot: /tmp/constellagent-paste-123.png',
      imagePaths: ['/tmp/constellagent-paste-123.png'],
    },
  ]
  assert.equal(
    summarizeAskUserQuestionAnswers(answers),
    'Visuals: Use current layout — Match the hero spacing. • Images: /tmp/constellagent-paste-123.png',
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
