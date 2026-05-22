import { randomUUID } from 'node:crypto'
import {
  clampAskQuestionHeader,
  type ConductorAskQuestionPrompt,
} from '../../shared/conductor-ask-question-types'
import { getConductorQuestionBridge } from './conductor-question-bridge'
import { evToolFinished, evToolStarted, type AgentTurnContext } from './agent-driver'

interface CursorAskQuestionArgs {
  readonly title?: string
  readonly questions?: readonly CursorAskQuestionItem[]
}

interface CursorAskQuestionItem {
  readonly id?: string
  readonly prompt?: string
  readonly options?: readonly { id?: string; label?: string; description?: string }[]
  readonly allow_multiple?: boolean
}

interface CursorInteractionQuery {
  readonly id: string
  readonly query?: {
    readonly case?: string
    readonly value?: {
      readonly toolCallId?: string
      readonly args?: CursorAskQuestionArgs
    }
  }
}

type AskQuestionToolPb = {
  tz: {
    fromJson: (value: unknown) => unknown
  }
}

type InteractionResponses = {
  askQuestion: (id: string, result: unknown) => unknown
}

export function normalizeCursorAskQuestions(args: CursorAskQuestionArgs | undefined): ConductorAskQuestionPrompt[] {
  const questions = args?.questions ?? []
  return questions
    .map((item): ConductorAskQuestionPrompt | null => {
      const question = item.prompt?.trim() ?? ''
      const header = clampAskQuestionHeader(item.id?.trim() || args?.title?.trim() || 'Question')
      const options = (item.options ?? [])
        .map((option) => ({
          label: option.label?.trim() ?? '',
          ...(option.description?.trim() ? { description: option.description.trim() } : {}),
        }))
        .filter((option) => option.label.length > 0)
      if (!question || options.length === 0) return null
      return {
        question,
        header,
        options,
        ...(item.allow_multiple === true ? { multiSelect: true } : {}),
      } satisfies ConductorAskQuestionPrompt
    })
    .filter((item): item is ConductorAskQuestionPrompt => item !== null)
}

export function mapConductorAnswersToCursorSuccess(
  questions: readonly ConductorAskQuestionPrompt[],
  details: import('../../shared/conductor-ask-question-types').ConductorAskQuestionDetails,
  cursorQuestions: readonly CursorAskQuestionItem[],
): Array<{ questionId: string; selectedOptionIds: string[]; freeformText: string }> {
  if (details.cancelled) return []
  return details.answers.map((answer, index) => {
    const cursorQuestion = cursorQuestions[index]
    const questionId = cursorQuestion?.id ?? answer.header
    const selectedOptionIds: string[] = []
    if (answer.wasCustom) {
      return { questionId, selectedOptionIds: [], freeformText: String(answer.answer) }
    }
    const selectedLabels = Array.isArray(answer.answer) ? answer.answer : [answer.answer]
    for (const label of selectedLabels) {
      const match = (cursorQuestion?.options ?? []).find((option) => option.label === label)
      if (match?.id) selectedOptionIds.push(match.id)
      else {
        const idx = (questions[index]?.options ?? []).findIndex((option) => option.label === label)
        if (idx >= 0) selectedOptionIds.push(String(idx + 1))
      }
    }
    return { questionId, selectedOptionIds, freeformText: answer.details?.trim() ?? '' }
  })
}

export function createCursorAskQuestionHandler(
  ctx: AgentTurnContext,
): (query: unknown, Responses: unknown, askQuestionToolPb: unknown) => Promise<unknown> {
  return async (rawQuery, Responses, askQuestionToolPb) => {
    if (!ctx.plan) return null
    const query = rawQuery as CursorInteractionQuery
    const responses = Responses as InteractionResponses
    const pb = askQuestionToolPb as AskQuestionToolPb

    const args = query.query?.value?.args
    const cursorQuestions = args?.questions ?? []
    const questions = normalizeCursorAskQuestions(args)
    if (questions.length === 0) return null

    const callId = query.query?.value?.toolCallId ?? randomUUID()
    ctx.emit(evToolStarted(ctx.sessionRef, callId, 'AskQuestion', args))

    try {
      const details = await getConductorQuestionBridge().registerPending({
        sessionId: ctx.sessionRef.sessionId,
        callId,
        provider: 'cursor',
        source: 'askQuestion',
        questions,
      })

      if (details.cancelled) {
        ctx.emit(evToolFinished(ctx.sessionRef, callId, false, details))
        return responses.askQuestion(
          query.id,
          pb.tz.fromJson({ rejected: { reason: 'User cancelled' } }),
        )
      }

      const answers = mapConductorAnswersToCursorSuccess(questions, details, cursorQuestions)
      ctx.emit(evToolFinished(ctx.sessionRef, callId, true, details))
      return responses.askQuestion(
        query.id,
        pb.tz.fromJson({
          success: {
            answers: answers.map((answer) => ({
              question_id: answer.questionId,
              selected_option_ids: answer.selectedOptionIds,
              freeform_text: answer.freeformText,
            })),
          },
        }),
      )
    } catch (err) {
      ctx.emit(evToolFinished(ctx.sessionRef, callId, false, undefined))
      throw err
    }
  }
}
