import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Editor, type EditorTheme, Key, Text, matchesKey, truncateToWidth } from '@mariozechner/pi-tui'
import { Type, type Static } from '@sinclair/typebox'

export interface AskUserQuestionOption {
  label: string
  description?: string
}

export interface AskUserQuestionInputQuestion {
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect?: boolean
}

export interface AskUserQuestionAnswer {
  question: string
  header: string
  answer: string | string[]
  wasCustom: boolean
  selectedOptions: string[]
  /** Optional free-text elaboration alongside preset choice(s). Omitted when empty for backward compatibility. */
  details?: string
}

export interface AskUserQuestionDetails {
  cancelled: boolean
  answers: AskUserQuestionAnswer[]
}

export interface AskUserQuestionHooks {
  onComplete?: (details: AskUserQuestionDetails) => void | Promise<void>
}

const OptionSchema = Type.Object({
  label: Type.String({ description: 'Choice label shown to the user' }),
  description: Type.Optional(Type.String({ description: 'Optional explanation or tradeoff for the choice' })),
})

const QuestionSchema = Type.Object({
  question: Type.String({ description: 'Specific question to ask the user' }),
  header: Type.String({ description: 'Short label for the question tab. Keep it short.' }),
  multiSelect: Type.Optional(Type.Boolean({ description: 'Allow choosing multiple options for this question' })),
  options: Type.Array(OptionSchema, { description: '2-4 strong options the user can choose from' }),
})

const AskUserQuestionParams = Type.Object({
  questions: Type.Array(QuestionSchema, {
    description: 'One to four clarifying questions for the user',
    minItems: 1,
    maxItems: 4,
  }),
})

/** For CI / `pi -p` only: print mode has no UI, so clarifications must be synthesized when this env is set. */
function headlessClarificationEnabled(): boolean {
  return process.env.PI_CONSTELL_HEADLESS_CLARIFICATION?.trim() === '1'
}

function buildHeadlessAskUserQuestionDetails(params: Static<typeof AskUserQuestionParams>): AskUserQuestionDetails {
  const answers: AskUserQuestionAnswer[] = params.questions.map((question) => {
    const header = clampHeader(question.header)
    const options = question.options
    if (question.multiSelect === true) {
      const labels = options.length ? [options[0]!.label] : ['OK']
      return {
        question: question.question,
        header,
        answer: labels,
        wasCustom: false,
        selectedOptions: labels,
      }
    }
    const first = options[0]?.label ?? 'OK'
    return {
      question: question.question,
      header,
      answer: first,
      wasCustom: false,
      selectedOptions: [first],
    }
  })
  return { cancelled: false, answers }
}

interface PromptQuestion {
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

interface QuestionState {
  selected: Set<number>
  extraDetails: string | null
  customOnlyAnswer: string | null
}

function clampHeader(header: string): string {
  return header.trim().slice(0, 12) || 'Question'
}

function isSpaceToggleInput(data: string): boolean {
  return data === ' ' || matchesKey(data, Key.space)
}

function summarizeAskUserQuestionAnswer(answer: AskUserQuestionAnswer): string {
  const value = Array.isArray(answer.answer) ? answer.answer.join(', ') : answer.answer
  const detail = answer.details?.trim()
  return `${answer.header}: ${value}${detail ? ` — ${detail}` : ''}`
}

export function summarizeAskUserQuestionAnswers(answers: AskUserQuestionAnswer[]): string {
  return answers.map(summarizeAskUserQuestionAnswer).join('\n')
}

export function formatAskUserQuestionDetails(details: AskUserQuestionDetails): string | null {
  if (details.cancelled) return null
  return summarizeAskUserQuestionAnswers(details.answers)
}

export default function registerAskUserQuestion(pi: ExtensionAPI, hooks: AskUserQuestionHooks = {}): void {
  pi.registerTool({
    name: 'askUserQuestion',
    label: 'Ask User Question',
    description: 'Ask the user one to four clarifying questions with Claude Code-style keyboard navigation and custom free-text answers.',
    promptSnippet: 'Ask the user clarifying multiple-choice questions with keyboard navigation and custom free-text answers. In plan mode, investigate first, then ask an initial batch of 3-4 strong questions; later follow-ups should usually be 1-2 questions.',
    promptGuidelines: [
      'Use askUserQuestion as the blocking clarification step before drafting a plan when important scope, behavior, or validation choices are still unresolved.',
      'In plan mode, do deeper repo investigation first so your options and recommendations are grounded in the codebase.',
      'For the initial clarification pass in plan mode, prefer 3-4 questions in one call. For follow-up clarification after the plan changes, prefer 1-2 questions and never exceed 4 questions in one call.',
      'Keep to 1-4 questions per call and 2-4 strong options per question.',
      'Prefer short headers, include tradeoffs in option descriptions, and include a recommended option when you have a strong default.',
      'Users can pick preset option(s) and still add optional extra details; multi-select uses spacebar to toggle the highlighted option.',
    ],
    parameters: AskUserQuestionParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        if (!headlessClarificationEnabled()) {
          return {
            content: [{ type: 'text', text: 'Error: askUserQuestion requires an interactive UI.' }],
            details: { cancelled: true, answers: [] } satisfies AskUserQuestionDetails,
          }
        }
        const details = buildHeadlessAskUserQuestionDetails(params)
        await hooks.onComplete?.(details)
        return {
          content: [{ type: 'text', text: summarizeAskUserQuestionAnswers(details.answers) }],
          details,
        }
      }

      const questions: PromptQuestion[] = params.questions.map((question) => ({
        ...question,
        header: clampHeader(question.header),
        multiSelect: question.multiSelect === true,
      }))

      const details = await ctx.ui.custom<AskUserQuestionDetails>((tui, theme, _keybindings, done) => {
        const editorTheme: EditorTheme = {
          borderColor: (text) => theme.fg('accent', text),
          selectList: {
            selectedPrefix: (text) => theme.fg('accent', text),
            selectedText: (text) => theme.fg('accent', text),
            description: (text) => theme.fg('muted', text),
            scrollInfo: (text) => theme.fg('dim', text),
            noMatch: (text) => theme.fg('warning', text),
          },
        }

        const questionStates = new Map<string, QuestionState>(
          questions.map((question) => [
            question.header,
            { selected: new Set<number>(), extraDetails: null, customOnlyAnswer: null },
          ]),
        )

        const optionIndexes = new Map<string, number>(questions.map((question) => [question.header, 0]))
        const editor = new Editor(tui, editorTheme)
        let currentTab = 0
        let inputMode = false
        let inputKind: 'custom' | 'details' | null = null
        let inputHeader: string | null = null
        let cachedLines: string[] | undefined

        function refresh(): void {
          cachedLines = undefined
          tui.requestRender()
        }

        function currentQuestion(): PromptQuestion | undefined {
          return questions[currentTab]
        }

        function currentState(): QuestionState | undefined {
          const question = currentQuestion()
          return question ? questionStates.get(question.header) : undefined
        }

        function currentIndex(): number {
          const question = currentQuestion()
          return question ? (optionIndexes.get(question.header) ?? 0) : 0
        }

        function setCurrentIndex(index: number): void {
          const question = currentQuestion()
          if (!question) return
          optionIndexes.set(question.header, index)
        }

        function isSubmitTab(): boolean {
          return currentTab === questions.length
        }

        function allAnswered(): boolean {
          return questions.every((question) => {
            const state = questionStates.get(question.header)
            return Boolean(state && (state.customOnlyAnswer || state.selected.size > 0))
          })
        }

        function buildAnswers(): AskUserQuestionAnswer[] {
          return questions.map((question) => {
            const state = questionStates.get(question.header)!
            if (state.customOnlyAnswer) {
              return {
                question: question.question,
                header: question.header,
                answer: state.customOnlyAnswer,
                wasCustom: true,
                selectedOptions: [],
              }
            }

            const selectedOptions = [...state.selected]
              .sort((left, right) => left - right)
              .map((index) => question.options[index]?.label)
              .filter((value): value is string => Boolean(value))

            const trimmedDetails = state.extraDetails?.trim()
            const base: AskUserQuestionAnswer = {
              question: question.question,
              header: question.header,
              answer: question.multiSelect ? selectedOptions : (selectedOptions[0] ?? ''),
              wasCustom: false,
              selectedOptions,
            }
            if (trimmedDetails) base.details = trimmedDetails
            return base
          })
        }

        function autoSubmitIfComplete(): void {
          const question = currentQuestion()
          if (!question || question.multiSelect) return
          if (currentTab !== questions.length - 1) return
          if (!allAnswered()) return
          done({ cancelled: false, answers: buildAnswers() })
        }

        editor.onSubmit = (value) => {
          if (!inputHeader || !inputKind) return
          const trimmed = value.trim()
          const state = questionStates.get(inputHeader)
          if (!state) return
          if (inputKind === 'custom') {
            if (!trimmed) return
            state.customOnlyAnswer = trimmed
            state.selected.clear()
            state.extraDetails = null
          } else {
            state.extraDetails = trimmed || null
          }
          inputMode = false
          inputHeader = null
          inputKind = null
          editor.setText('')
          autoSubmitIfComplete()
          refresh()
        }

        function toggleOption(index: number): void {
          const question = currentQuestion()
          const state = currentState()
          if (!question || !state) return

          const detailsRowIndex = question.options.length
          const customRowIndex = question.options.length + 1

          if (index === customRowIndex) {
            inputMode = true
            inputKind = 'custom'
            inputHeader = question.header
            editor.setText(state.customOnlyAnswer ?? '')
            refresh()
            return
          }

          if (index === detailsRowIndex) {
            inputMode = true
            inputKind = 'details'
            inputHeader = question.header
            editor.setText(state.extraDetails ?? '')
            refresh()
            return
          }

          state.customOnlyAnswer = null
          if (question.multiSelect) {
            if (state.selected.has(index)) state.selected.delete(index)
            else state.selected.add(index)
            refresh()
            return
          }

          state.selected = new Set([index])
          autoSubmitIfComplete()
          if (currentTab < questions.length - 1) currentTab += 1
          refresh()
        }

        function handleInput(data: string): void {
          if (inputMode) {
            if (matchesKey(data, Key.escape)) {
              inputMode = false
              inputHeader = null
              inputKind = null
              editor.setText('')
              refresh()
              return
            }
            editor.handleInput(data)
            refresh()
            return
          }

          if (matchesKey(data, Key.escape)) {
            done({ cancelled: true, answers: [] })
            return
          }

          if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
            currentTab = (currentTab + 1) % (questions.length + 1)
            refresh()
            return
          }
          if (matchesKey(data, Key.shift('tab')) || matchesKey(data, Key.left)) {
            currentTab = (currentTab - 1 + questions.length + 1) % (questions.length + 1)
            refresh()
            return
          }

          if (isSubmitTab()) {
            if (matchesKey(data, Key.enter) && allAnswered()) {
              done({ cancelled: false, answers: buildAnswers() })
            }
            return
          }

          const question = currentQuestion()
          if (!question) return
          const maxIndex = question.options.length + 1
          const index = currentIndex()

          if (matchesKey(data, Key.up)) {
            setCurrentIndex(Math.max(0, index - 1))
            refresh()
            return
          }
          if (matchesKey(data, Key.down)) {
            setCurrentIndex(Math.min(maxIndex, index + 1))
            refresh()
            return
          }
          if (question.multiSelect && isSpaceToggleInput(data)) {
            if (index <= question.options.length - 1) {
              toggleOption(index)
            }
            return
          }
          if (matchesKey(data, Key.enter)) {
            toggleOption(index)
          }
        }

        function render(width: number): string[] {
          if (cachedLines) return cachedLines
          const lines: string[] = []
          const add = (line: string) => lines.push(truncateToWidth(line, width))

          add(theme.fg('accent', '─'.repeat(Math.max(width, 1))))

          const tabs = questions.map((question, index) => {
            const state = questionStates.get(question.header)!
            const answered = state.customOnlyAnswer || state.selected.size > 0
            const active = index === currentTab
            const token = answered ? '■' : '□'
            const label = ` ${token} ${question.header} `
            if (active) return theme.bg('selectedBg', theme.fg('text', label))
            return theme.fg(answered ? 'success' : 'muted', label)
          })
          const submitActive = isSubmitTab()
          const submitLabel = ' \u2713 Review '
          tabs.push(submitActive
            ? theme.bg('selectedBg', theme.fg('text', submitLabel))
            : theme.fg(allAnswered() ? 'success' : 'dim', submitLabel))
          add(` ${tabs.join(' ')}`)
          lines.push('')

          if (isSubmitTab()) {
            add(theme.fg('accent', theme.bold(' Review your answers')))
            lines.push('')
            for (const answer of buildAnswers()) {
              const rendered = Array.isArray(answer.answer) ? answer.answer.join(', ') : answer.answer
              const prefix = answer.wasCustom ? theme.fg('muted', '(custom) ') : ''
              const detail = answer.details?.trim()
              add(`${theme.fg('muted', `${answer.header}: `)}${prefix}${theme.fg('text', rendered || '—')}`)
              if (detail) add(` ${theme.fg('muted', 'Details: ')}${theme.fg('text', detail)}`)
            }
            lines.push('')
            add(allAnswered()
              ? theme.fg('success', ' Press Enter to submit your answers')
              : theme.fg('warning', ' Answer every question before submitting'))
          } else {
            const question = currentQuestion()!
            const state = currentState()!
            add(theme.fg('text', ` ${question.question}`))
            lines.push('')
            const lastRow = question.options.length + 1
            for (let index = 0; index <= lastRow; index += 1) {
              const isDetails = index === question.options.length
              const isCustom = index === question.options.length + 1
              const option = isCustom
                ? { label: 'My own thoughts', description: 'Answer entirely in your own words instead of preset options.' }
                : isDetails
                  ? { label: 'Extra details (optional)', description: 'Add nuance on top of your preset choice(s).' }
                  : question.options[index]!
              const active = index === currentIndex()
              const selected = !isDetails && !isCustom && state.selected.has(index)
              const detailsFilled = isDetails && Boolean(state.extraDetails?.trim())
              const customActive = isCustom && Boolean(state.customOnlyAnswer)
              const marker = question.multiSelect && !isDetails && !isCustom
                ? (selected ? '[x]' : '[ ]')
                : (isDetails ? (detailsFilled ? '(+)' : '( )')
                    : isCustom
                      ? (customActive ? '(•)' : '( )')
                      : (selected ? '(•)' : '( )'))
              const prefix = active ? theme.fg('accent', '> ') : '  '
              const color = active ? 'accent' : 'text'
              add(`${prefix}${theme.fg(color, `${marker} ${option.label}`)}`)
              if (option.description) add(`     ${theme.fg('muted', option.description)}`)
              if (isCustom && state.customOnlyAnswer) add(`     ${theme.fg('success', `Current: ${state.customOnlyAnswer}`)}`)
              if (isDetails && state.extraDetails?.trim()) {
                add(`     ${theme.fg('success', `Current: ${state.extraDetails.trim()}`)}`)
              }
            }
            if (inputMode) {
              lines.push('')
              const label = inputKind === 'details' ? ' Extra details:' : ' Your answer:'
              add(theme.fg('muted', label))
              for (const line of editor.render(Math.max(width - 2, 1))) add(` ${line}`)
            }
            lines.push('')
            add(theme.fg('dim', question.multiSelect
              ? ' Tab/←→ switch questions • ↑↓ move • Space toggles options • Enter row action • Esc cancel'
              : ' Tab/←→ switch questions • ↑↓ move • Enter choose row • Esc cancel'))
          }

          add(theme.fg('accent', '─'.repeat(Math.max(width, 1))))
          cachedLines = lines
          return lines
        }

        return {
          render,
          invalidate: () => {
            cachedLines = undefined
          },
          handleInput,
        }
      })

      if (details.cancelled) {
        return {
          content: [{ type: 'text', text: 'User cancelled askUserQuestion.' }],
          details,
        }
      }

      await hooks.onComplete?.(details)

      return {
        content: [{ type: 'text', text: summarizeAskUserQuestionAnswers(details.answers) }],
        details,
      }
    },

    renderCall(args, theme) {
      const count = Array.isArray(args.questions) ? args.questions.length : 0
      return new Text(
        theme.fg('toolTitle', theme.bold('askUserQuestion ')) + theme.fg('muted', `${count} question${count === 1 ? '' : 's'}`),
        0,
        0,
      )
    },

    renderResult(result, _options, theme) {
      const details = result.details as AskUserQuestionDetails | undefined
      if (!details || details.cancelled) return new Text(theme.fg('warning', 'Cancelled'), 0, 0)
      return new Text(details.answers.map((answer) => {
        const value = Array.isArray(answer.answer) ? answer.answer.join(', ') : answer.answer
        const prefix = answer.wasCustom ? theme.fg('muted', '(custom) ') : ''
        const detail = answer.details?.trim()
        const detailSuffix = detail ? theme.fg('muted', ` — ${detail}`) : ''
        return `${theme.fg('success', '\u2713 ')}${theme.fg('accent', answer.header)}: ${prefix}${value}${detailSuffix}`
      }).join('\n'), 0, 0)
    },
  })
}
