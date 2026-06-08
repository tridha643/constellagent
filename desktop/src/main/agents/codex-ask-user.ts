import {
  clampAskQuestionHeader,
  formatAskQuestionDetails,
  type ConductorAskQuestionDetails,
  type ConductorAskQuestionOption,
  type ConductorAskQuestionPrompt,
} from '../../shared/conductor-ask-question-types'

export interface CodexAskUserRequest {
  readonly questions: readonly ConductorAskQuestionPrompt[]
  readonly questionIds: readonly string[]
  readonly rawBlock: string
}

export interface CodexAppServerRequestUserInputParams {
  readonly itemId: string
  readonly threadId: string
  readonly turnId: string
  readonly questions: unknown
}

export function parseCodexAskUserToolRequest(value: unknown): CodexAskUserRequest | null {
  const parsed = parseToolArguments(value)
  const normalized = normalizeCodexAskUserQuestions(parsed)
  if (!normalized) return null
  return {
    questions: normalized.questions,
    questionIds: normalized.questionIds,
    rawBlock: typeof value === 'string' ? value : JSON.stringify(value),
  }
}

export function parseAppServerRequestUserInput(params: unknown): CodexAskUserRequest | null {
  if (!isRecord(params) || !Array.isArray(params.questions)) return null
  const questions: ConductorAskQuestionPrompt[] = []
  const questionIds: string[] = []
  for (const rawQuestion of params.questions) {
    const normalized = normalizeAppServerAskUserQuestion(rawQuestion)
    if (!normalized) return null
    questions.push(normalized.prompt)
    questionIds.push(normalized.id)
  }
  if (questions.length < 1 || questions.length > 4) return null
  return {
    questions,
    questionIds,
    rawBlock: JSON.stringify(params),
  }
}

export function formatAppServerRequestUserInputResult(
  details: ConductorAskQuestionDetails,
  questionIds: readonly string[],
): { answers: Record<string, { answers: string[] }> } {
  const answers: Record<string, { answers: string[] }> = {}
  if (details.cancelled) return { answers }
  for (const [index, answer] of details.answers.entries()) {
    const questionId = questionIds[index]
    if (!questionId) continue
    const values = Array.isArray(answer.answer)
      ? answer.answer.map((entry) => entry.trim()).filter(Boolean)
      : answer.answer.trim()
        ? [answer.answer.trim()]
        : []
    if (!values.length) continue
    answers[questionId] = { answers: values }
  }
  return { answers }
}

export function formatCodexAskUserContinuation(details: ConductorAskQuestionDetails): string | null {
  const summary = formatAskQuestionDetails(details)
  if (!summary) return null
  return [
    'The user answered the Conductor request-user-input prompt. Continue the same task using these answers.',
    'Do not ask the same question again unless the answer conflicts with the task.',
    '',
    '<conductor-user-input-response>',
    summary,
    '</conductor-user-input-response>',
  ].join('\n')
}

function normalizeCodexAskUserQuestions(
  value: unknown,
): { questions: ConductorAskQuestionPrompt[]; questionIds: string[] } | null {
  if (!isRecord(value) || !Array.isArray(value.questions)) return null
  const questions: ConductorAskQuestionPrompt[] = []
  const questionIds: string[] = []
  for (const [index, rawQuestion] of value.questions.entries()) {
    const normalized = normalizeCodexAskUserQuestion(rawQuestion, `question-${index + 1}`)
    if (!normalized) return null
    questions.push(normalized.prompt)
    questionIds.push(normalized.id)
  }
  if (questions.length < 1 || questions.length > 4) return null
  return { questions, questionIds }
}

function normalizeAppServerAskUserQuestion(
  value: unknown,
): { id: string; prompt: ConductorAskQuestionPrompt } | null {
  if (!isRecord(value) || typeof value.question !== 'string') return null
  const question = value.question.trim()
  if (!question) return null
  const id =
    typeof value.id === 'string' && value.id.trim()
      ? value.id.trim()
      : typeof value.header === 'string' && value.header.trim()
        ? value.header.trim()
        : null
  if (!id) return null
  const header = clampAskQuestionHeader(
    typeof value.header === 'string' && value.header.trim() ? value.header : id,
  )
  if (!Array.isArray(value.options)) return null
  const options = value.options
    .map(normalizeCodexAskUserOption)
    .filter((option): option is ConductorAskQuestionOption => option !== null)
  if (options.length < 2 || options.length > 4) return null
  const selectionLimit =
    typeof value.selectionLimit === 'number'
      ? value.selectionLimit
      : typeof value.selection_limit === 'number'
        ? value.selection_limit
        : 1
  return {
    id,
    prompt: {
      question,
      header,
      options,
      ...(selectionLimit > 1 ? { multiSelect: true } : {}),
    },
  }
}

function normalizeCodexAskUserQuestion(
  value: unknown,
  fallbackId: string,
): { id: string; prompt: ConductorAskQuestionPrompt } | null {
  if (!isRecord(value) || typeof value.question !== 'string') return null
  const question = value.question.trim()
  if (!question) return null
  const id =
    typeof value.id === 'string' && value.id.trim()
      ? value.id.trim()
      : typeof value.header === 'string' && value.header.trim()
        ? value.header.trim()
        : fallbackId
  const header = clampAskQuestionHeader(
    typeof value.header === 'string' && value.header.trim() ? value.header : id,
  )
  if (!Array.isArray(value.options)) return null
  const options = value.options
    .map(normalizeCodexAskUserOption)
    .filter((option): option is ConductorAskQuestionOption => option !== null)
  if (options.length < 2 || options.length > 4) return null
  return {
    id,
    prompt: {
      question,
      header,
      options,
      ...(value.multiSelect === true ? { multiSelect: true } : {}),
    },
  }
}

function normalizeCodexAskUserOption(value: unknown): ConductorAskQuestionOption | null {
  if (!isRecord(value) || typeof value.label !== 'string') return null
  const label = value.label.trim()
  if (!label) return null
  const description = typeof value.description === 'string' ? value.description.trim() : ''
  return {
    label,
    ...(description ? { description } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseToolArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
