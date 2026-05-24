import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
import type { AgentProvider } from '../../../../shared/agent-chat-types'
import { hasFastVariant } from '../../../../shared/conductor-model-utils'
import {
  CONDUCTOR_PERSONALITY_OPTIONS,
  buildConductorSlashSections,
  flattenConductorSlashSections,
  getConductorHostCommands,
  harnessSkillsToSlashCommands,
  parseActiveSlashToken,
  type ConductorSlashCommand,
  type ConductorSlashSection,
} from '../../../../shared/conductor-composer-commands'

export interface UseConductorComposerSlashArgs {
  readonly text: string
  readonly setText: Dispatch<SetStateAction<string>>
  readonly composerRef: RefObject<HTMLTextAreaElement | null>
  readonly provider: AgentProvider
  readonly model: string
  readonly workspacePath: string
  readonly onSlashAction: (command: ConductorSlashCommand) => void
  readonly onPersonalitySelect: (value: string) => void
  readonly onNamePromptConfirm: (command: ConductorSlashCommand, value: string) => void
}

export function useConductorComposerSlash({
  text,
  setText,
  composerRef,
  provider,
  model,
  workspacePath,
  onSlashAction,
  onPersonalitySelect,
  onNamePromptConfirm,
}: UseConductorComposerSlashArgs) {
  const [cursor, setCursor] = useState(0)
  const [mainMenuIndex, setMainMenuIndex] = useState(0)
  const [pickCommand, setPickCommand] = useState<ConductorSlashCommand | null>(null)
  const [optionIndex, setOptionIndex] = useState(0)
  const [skills, setSkills] = useState<readonly { name: string; description: string; sourcePath: string }[]>([])

  useEffect(() => {
    if (!workspacePath) {
      setSkills([])
      return
    }
    let cancelled = false
    void window.api.skills
      .discoverHarness(provider, workspacePath)
      .then((next) => {
        if (!cancelled) setSkills(next)
      })
      .catch(() => {
        if (!cancelled) setSkills([])
      })
    return () => {
      cancelled = true
    }
  }, [provider, workspacePath])

  const slashToken = useMemo(() => parseActiveSlashToken(text, cursor), [text, cursor])

  const hostCommands = useMemo(
    () =>
      getConductorHostCommands({
        provider,
        includeFast: hasFastVariant(model, provider),
      }),
    [provider, model],
  )

  const skillCommands = useMemo(() => harnessSkillsToSlashCommands(skills), [skills])

  const slashSections: readonly ConductorSlashSection[] = useMemo(() => {
    if (!slashToken) return []
    return buildConductorSlashSections(slashToken.query, hostCommands, skillCommands)
  }, [slashToken, hostCommands, skillCommands])

  const flatCommands = useMemo(() => flattenConductorSlashSections(slashSections), [slashSections])

  const showPersonalityMenu = pickCommand?.picker === 'personality'
  const showNamePromptMenu =
    pickCommand?.picker === 'dir-name' || pickCommand?.picker === 'file-path'
  const showSlashMenu = Boolean(slashToken) && !showPersonalityMenu && !showNamePromptMenu && flatCommands.length > 0

  const selectedSlashCommand: ConductorSlashCommand | undefined = showPersonalityMenu
    ? pickCommand ?? undefined
    : showSlashMenu
      ? flatCommands[Math.min(mainMenuIndex, flatCommands.length - 1)]
      : undefined

  useEffect(() => {
    setMainMenuIndex(0)
  }, [slashToken?.from, slashToken?.query])

  useEffect(() => {
    setMainMenuIndex((index) => {
      if (flatCommands.length === 0) return 0
      return Math.min(index, flatCommands.length - 1)
    })
  }, [flatCommands.length])

  useEffect(() => {
    setOptionIndex(0)
  }, [pickCommand?.id])

  useEffect(() => {
    if (!slashToken) {
      setPickCommand(null)
    }
  }, [slashToken])

  const replaceRange = useCallback(
    (from: number, to: number, insert: string) => {
      setText((prev) => {
        const next = prev.slice(0, from) + insert + prev.slice(to)
        const pos = from + insert.length
        requestAnimationFrame(() => {
          const el = composerRef.current
          if (el) {
            el.focus()
            el.selectionStart = el.selectionEnd = pos
            setCursor(pos)
          }
        })
        return next
      })
    },
    [setText, composerRef],
  )

  const clearSlashToken = useCallback(() => {
    if (!slashToken) return
    replaceRange(slashToken.from, slashToken.to, '')
  }, [slashToken, replaceRange])

  const dismissSlashUi = useCallback(() => {
    clearSlashToken()
    setPickCommand(null)
  }, [clearSlashToken])

  const applySlashCommand = useCallback(
    (command: ConductorSlashCommand) => {
      if (!slashToken) return
      if (command.kind === 'skill') {
        replaceRange(slashToken.from, slashToken.to, `${command.command} `)
        setPickCommand(null)
        return
      }
      if (command.picker === 'personality' || command.picker === 'dir-name' || command.picker === 'file-path') {
        setPickCommand(command)
        setOptionIndex(0)
        return
      }
      clearSlashToken()
      setPickCommand(null)
      onSlashAction(command)
    },
    [slashToken, replaceRange, clearSlashToken, onSlashAction],
  )

  const applyNamePromptValue = useCallback(
    (value: string) => {
      if (!pickCommand) return
      clearSlashToken()
      const command = pickCommand
      setPickCommand(null)
      onNamePromptConfirm(command, value)
    },
    [pickCommand, clearSlashToken, onNamePromptConfirm],
  )

  const applyPersonalityOption = useCallback(
    (value: string) => {
      clearSlashToken()
      setPickCommand(null)
      onPersonalitySelect(value)
    },
    [clearSlashToken, onPersonalitySelect],
  )

  const onComposerSelectionChange = useCallback((pos: number) => {
    setCursor(pos)
  }, [])

  const wrapComposerKeyDown = useCallback(
    (base: (event: KeyboardEvent<HTMLTextAreaElement>) => void) =>
      (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (showPersonalityMenu) {
          const optionCount = CONDUCTOR_PERSONALITY_OPTIONS.length
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOptionIndex((index) => (index + 1) % optionCount)
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setOptionIndex((index) => (index - 1 + optionCount) % optionCount)
            return
          }
          if (event.key === 'Tab' && event.shiftKey) {
            event.preventDefault()
            setOptionIndex((index) => (index - 1 + optionCount) % optionCount)
            return
          }
          if (event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault()
            setOptionIndex((index) => (index + 1) % optionCount)
            return
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            const option = CONDUCTOR_PERSONALITY_OPTIONS[Math.min(optionIndex, optionCount - 1)]
            if (option) applyPersonalityOption(option.value)
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            dismissSlashUi()
            return
          }
        }

        if (showNamePromptMenu) {
          if (event.key === 'Escape') {
            event.preventDefault()
            dismissSlashUi()
            return
          }
        }

        if (showSlashMenu && flatCommands.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setMainMenuIndex((index) => (index + 1) % flatCommands.length)
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setMainMenuIndex((index) => (index - 1 + flatCommands.length) % flatCommands.length)
            return
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            const command = flatCommands[mainMenuIndex]
            if (command) applySlashCommand(command)
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            dismissSlashUi()
            return
          }
          if (event.key === 'Tab' && event.shiftKey) {
            event.preventDefault()
            setMainMenuIndex((index) => (index - 1 + flatCommands.length) % flatCommands.length)
            return
          }
          if (event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault()
            setMainMenuIndex((index) => (index + 1) % flatCommands.length)
            return
          }
        }

        base(event)
      },
    [
      showPersonalityMenu,
      optionIndex,
      applyPersonalityOption,
      dismissSlashUi,
      showNamePromptMenu,
      showSlashMenu,
      flatCommands,
      mainMenuIndex,
      applySlashCommand,
    ],
  )

  return {
    slashSections,
    showSlashMenu,
    showPersonalityMenu,
    showNamePromptMenu,
    namePromptVariant:
      pickCommand?.picker === 'dir-name' || pickCommand?.picker === 'file-path'
        ? pickCommand.picker
        : undefined,
    selectedSlashCommand,
    optionIndex,
    onSelectSlashCommand: applySlashCommand,
    onSelectPersonalityOption: applyPersonalityOption,
    onConfirmNamePrompt: applyNamePromptValue,
    onComposerSelectionChange,
    wrapComposerKeyDown,
    dismissSlashUi,
  }
}
