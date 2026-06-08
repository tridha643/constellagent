import {
  clampAskQuestionHeader,
  formatAskQuestionDetails,
  type ConductorAskQuestionDetails,
  type ConductorAskQuestionOption,
  type ConductorAskQuestionPrompt,
} from '../../shared/conductor-ask-question-types'

export interface CodexAskUserRequest {
  readonly questions: readonly ConductorAskQuestionPrompt[]
  readonly rawBlock: string
}

export function parseCodexAskUserToolRequest(value: unknown): CodexAskUserRequest | null {
  const parsed = parseToolArguments(value)
  const questions = normalizeCodexAskUserQuestions(parsed)
  if (!questions) return null
  return {
    questions,
    rawBlock: typeof value === 'string' ? value : JSON.stringify(value),
  }
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

function normalizeCodexAskUserQuestions(value: unknown): ConductorAskQuestionPrompt[] | null {
  if (!isRecord(value) || !Array.isArray(value.questions)) return null
  const questions = value.questions
    .map(normalizeCodexAskUserQuestion)
    .filter((question): question is ConductorAskQuestionPrompt => question !== null)
  if (questions.length < 1 || questions.length > 3) return null
  return questions
}

function normalizeCodexAskUserQuestion(value: unknown): ConductorAskQuestionPrompt | null {
  if (!isRecord(value)) return null
  if (typeof value.question !== 'string' || typeof value.header !== 'string') return null
  const question = value.question.trim()
  const header = clampAskQuestionHeader(value.header)
  if (!question) return null
  if (!Array.isArray(value.options)) return null
  const options = value.options
    .map(normalizeCodexAskUserOption)
    .filter((option): option is ConductorAskQuestionOption => option !== null)
  if (options.length < 2 || options.length > 3) return null
  return {
    question,
    header,
    options,
    ...(value.multiSelect === true ? { multiSelect: true } : {}),
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
