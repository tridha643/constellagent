/** Shared AskQuestion shapes for Conductor plan mode (mirrors pi-constell askUserQuestion). */

export interface ConductorAskQuestionOption {
  readonly label: string
  readonly description?: string
}

export interface ConductorAskQuestionPrompt {
  readonly question: string
  readonly header: string
  readonly options: readonly ConductorAskQuestionOption[]
  readonly multiSelect?: boolean
}

export interface ConductorAskQuestionOptionMapping {
  readonly letter: string
  readonly index: number
  readonly label: string
}

export interface ConductorAskQuestionAnswer {
  readonly question: string
  readonly header: string
  readonly answer: string | string[]
  readonly wasCustom: boolean
  readonly selectedOptions: string[]
  readonly optionMappings?: readonly ConductorAskQuestionOptionMapping[]
  readonly details?: string
}

export interface ConductorAskQuestionDetails {
  readonly cancelled: boolean
  readonly answers: readonly ConductorAskQuestionAnswer[]
}

export type ConductorBlockingQuestionProvider = 'cursor' | 'codex' | 'pi'
export type ConductorBlockingQuestionSource = 'askQuestion' | 'mcpAskUserQuestion' | 'piHostUi'

export interface ConductorBlockingQuestion {
  readonly requestId: string
  readonly sessionId: string
  readonly callId: string
  readonly provider: ConductorBlockingQuestionProvider
  readonly source: ConductorBlockingQuestionSource
  readonly questions: readonly ConductorAskQuestionPrompt[]
  readonly createdAt: string
}

export interface ConductorBlockingQuestionResponse {
  readonly requestId: string
  readonly details: ConductorAskQuestionDetails
}

export type AgentChatRunPhase = 'idle' | 'running' | 'awaitingUser' | 'failed'

export function clampAskQuestionHeader(header: string): string {
  return header.trim().slice(0, 12) || 'Question'
}

export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index)
}

export function buildOptionMappings(
  options: readonly ConductorAskQuestionOption[],
): ConductorAskQuestionOptionMapping[] {
  return options.map((option, index) => ({
    letter: optionLetter(index),
    index: index + 1,
    label: option.label,
  }))
}

function summarizeOptionMappings(
  optionMappings: readonly ConductorAskQuestionOptionMapping[] | undefined,
): string {
  if (!optionMappings?.length) return ''
  return optionMappings.map((mapping) => `${mapping.letter}/${mapping.index}=${mapping.label}`).join(', ')
}

export function summarizeAskQuestionAnswer(answer: ConductorAskQuestionAnswer): string {
  const value = Array.isArray(answer.answer) ? answer.answer.join(', ') : answer.answer
  const mapping = summarizeOptionMappings(answer.optionMappings)
  const detail = answer.details?.trim()
  return `${answer.header}: ${value}${mapping ? ` (choices: ${mapping})` : ''}${detail ? ` — ${detail}` : ''}`
}

export function summarizeAskQuestionAnswers(answers: readonly ConductorAskQuestionAnswer[]): string {
  return answers.map(summarizeAskQuestionAnswer).join('\n')
}

export function formatAskQuestionDetails(details: ConductorAskQuestionDetails): string | null {
  if (details.cancelled) return null
  return summarizeAskQuestionAnswers(details.answers)
}
