import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Editor, type EditorTheme, Key, Text, matchesKey, truncateToWidth } from '@mariozechner/pi-tui'
import { Type } from '@sinclair/typebox'

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

interface PromptQuestion {
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

interface QuestionState {
  selected: Set<number>
  customAnswer: string | null
}

function clampHeader(header: string): string {
  return header.trim().slice(0, 12) || 'Question'
}

function summarizeAnswers(answers: AskUserQuestionAnswer[]): string {
  return answers.map((answer) => {
    const value = Array.isArray(answer.answer) ? answer.answer.join(', ') : answer.answer
    return `${answer.header}: ${value}`
  }).join('\n')
}

export function formatAskUserQuestionDetails(details: AskUserQuestionDetails): string | null {
  if (details.cancelled) return null
  return summarizeAnswers(details.answers)
}

export default function registerAskUserQuestion(pi: ExtensionAPI, hooks: AskUserQuestionHooks = {}): void {
  pi.registerTool({
    name: 'askUserQuestion',
    label: 'Ask User Question',
    description: 'Ask the user one to four clarifying questions with Claude Code-style keyboard navigation and custom free-text answers.',
    promptSnippet: 'Ask the user clarifying multiple-choice questions with keyboard navigation and custom free-text answers. In plan mode, ask one question at a time and wait for the answer before the next question.',
    promptGuidelines: [
      'Use askUserQuestion as the blocking clarification step before drafting a plan when important scope, behavior, or validation choices are still unresolved.',
      'In plan mode, prefer exactly 1 question per call and wait for the answer before asking the next follow-up question.',
      'Keep to 1-4 questions per call and 2-4 strong options per question.',
      'Prefer short headers, include tradeoffs in option descriptions, and include a recommended option when you have a strong default.',
    ],
    parameters: AskUserQuestionParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return {
          content: [{ type: 'text', text: 'Error: askUserQuestion requires an interactive UI.' }],
          details: { cancelled: true, answers: [] } satisfies AskUserQuestionDetails,
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
          questions.map((question) => [question.header, { selected: new Set<number>(), customAnswer: null }]),
        )

        const optionIndexes = new Map<string, number>(questions.map((question) => [question.header, 0]))
        const editor = new Editor(tui, editorTheme)
        let currentTab = 0
        let inputMode = false
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
            return Boolean(state && (state.customAnswer || state.selected.size > 0))
          })
        }

        function buildAnswers(): AskUserQuestionAnswer[] {
          return questions.map((question) => {
            const state = questionStates.get(question.header)!
            if (state.customAnswer) {
              return {
                question: question.question,
                header: question.header,
                answer: state.customAnswer,
                wasCustom: true,
                selectedOptions: [],
              }
            }

            const selectedOptions = [...state.selected]
              .sort((left, right) => left - right)
              .map((index) => question.options[index]?.label)
              .filter((value): value is string => Boolean(value))

            return {
              question: question.question,
              header: question.header,
              answer: question.multiSelect ? selectedOptions : (selectedOptions[0] ?? ''),
              wasCustom: false,
              selectedOptions,
            }
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
          if (!inputHeader) return
          const trimmed = value.trim()
          if (!trimmed) return
          const state = questionStates.get(inputHeader)
          if (!state) return
          state.customAnswer = trimmed
          state.selected.clear()
          inputMode = false
          inputHeader = null
          editor.setText('')
          autoSubmitIfComplete()
          refresh()
        }

        function toggleOption(index: number): void {
          const question = currentQuestion()
          const state = currentState()
          if (!question || !state) return

          if (index === question.options.length) {
            inputMode = true
            inputHeader = question.header
            editor.setText(state.customAnswer ?? '')
            refresh()
            return
          }

          state.customAnswer = null
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
          const maxIndex = question.options.length
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
          if (matchesKey(data, Key.space) && question.multiSelect) {
            toggleOption(index)
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
            const answered = state.customAnswer || state.selected.size > 0
            const active = index === currentTab
            const token = answered ? '■' : '□'
            const label = ` ${token} ${question.header} `
            if (active) return theme.bg('selectedBg', theme.fg('text', label))
            return theme.fg(answered ? 'success' : 'muted', label)
          })
          const submitActive = isSubmitTab()
          const submitLabel = ' ✓ Review '
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
              add(`${theme.fg('muted', `${answer.header}: `)}${prefix}${theme.fg('text', rendered || '—')}`)
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
            for (let index = 0; index <= question.options.length; index += 1) {
              const isCustom = index === question.options.length
              const option = isCustom
                ? { label: 'My own thoughts', description: 'Type your own answer instead of choosing a preset option.' }
                : question.options[index]!
              const active = index === currentIndex()
              const selected = isCustom ? Boolean(state.customAnswer) : state.selected.has(index)
              const marker = question.multiSelect ? (selected ? '[x]' : '[ ]') : (selected ? '(•)' : '( )')
              const prefix = active ? theme.fg('accent', '> ') : '  '
              const color = active ? 'accent' : 'text'
              add(`${prefix}${theme.fg(color, `${marker} ${option.label}`)}`)
              if (option.description) add(`     ${theme.fg('muted', option.description)}`)
              if (isCustom && state.customAnswer) add(`     ${theme.fg('success', `Current: ${state.customAnswer}`)}`)
            }
            if (inputMode) {
              lines.push('')
              add(theme.fg('muted', ' Your answer:'))
              for (const line of editor.render(Math.max(width - 2, 1))) add(` ${line}`)
            }
            lines.push('')
            add(theme.fg('dim', question.multiSelect
              ? ' Tab/←→ switch questions • ↑↓ move • Space toggle • Enter choose/custom • Esc cancel'
              : ' Tab/←→ switch questions • ↑↓ move • Enter choose/custom • Esc cancel'))
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
        content: [{ type: 'text', text: summarizeAnswers(details.answers) }],
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
        return `${theme.fg('success', '✓ ')}${theme.fg('accent', answer.header)}: ${prefix}${value}`
      }).join('\n'), 0, 0)
    },
  })
}
