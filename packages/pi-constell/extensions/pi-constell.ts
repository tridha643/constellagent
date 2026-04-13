import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { AssistantMessage, TextContent } from '@mariozechner/pi-ai'
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent'
import registerAskUserQuestion, { type AskUserQuestionDetails } from './ask-user-question.js'
import { ensureActivePlanPath, isSafeCommand, notifyConstellagent, readPlanFile, resolvePlanToolPath, savePlanFile } from './utils.js'

const PLAN_MODE_TOOLS = ['read', 'bash', 'grep', 'find', 'ls', 'write', 'edit', 'askUserQuestion']
const FALLBACK_NORMAL_TOOLS = ['read', 'bash', 'edit', 'write']
const STATE_TYPE = 'pi-constell-plan-state'

interface PersistedState {
  enabled: boolean
  activePlanPath: string | null
  lastSavedPath: string | null
  lastSavedText: string | null
  lastPrompt: string | null
  lastClarifications: string | null
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === 'assistant' && Array.isArray(message.content)
}

function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function currentModelId(ctx: ExtensionContext): string | null {
  return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null
}

function extractLatestClarifications(messages: AgentMessage[]): string | null {
  const toolResult = [...messages].reverse().find((message) => {
    const candidate = message as AgentMessage & { role?: string; toolName?: string; details?: AskUserQuestionDetails }
    return candidate.role === 'toolResult' && candidate.toolName === 'askUserQuestion'
  }) as (AgentMessage & { details?: AskUserQuestionDetails }) | undefined

  if (!toolResult?.details || toolResult.details.cancelled) return null
  return toolResult.details.answers
    .map((answer: AskUserQuestionDetails['answers'][number]) => `${answer.header}: ${Array.isArray(answer.answer) ? answer.answer.join(', ') : answer.answer}`)
    .join('\n')
}

export default function piConstell(pi: ExtensionAPI): void {
  registerAskUserQuestion(pi)

  let planModeEnabled = false
  let previousTools: string[] | null = null
  let activePlanPath: string | null = null
  let lastSavedPath: string | null = null
  let lastSavedText: string | null = null
  let lastPrompt: string | null = null
  let lastClarifications: string | null = null

  pi.registerFlag('plan', {
    description: 'Start in pi-constell-plan mode',
    type: 'boolean',
    default: false,
  })

  function persistState(): void {
    pi.appendEntry(STATE_TYPE, {
      enabled: planModeEnabled,
      activePlanPath,
      lastSavedPath,
      lastSavedText,
      lastPrompt,
      lastClarifications,
    } satisfies PersistedState)
  }

  function relativePlanPath(ctx: ExtensionContext): string | null {
    return activePlanPath ? resolvePlanToolPath(ctx.cwd, activePlanPath).replace(`${ctx.cwd}/`, '') : null
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (!planModeEnabled) {
      ctx.ui.setStatus('pi-constell-plan', undefined)
      return
    }

    const label = relativePlanPath(ctx) ?? lastSavedPath?.replace(`${ctx.cwd}/`, '') ?? 'plan mode'
    ctx.ui.setStatus('pi-constell-plan', ctx.ui.theme.fg('warning', `⏸ PI Constell Plan → ${label}`))
  }

  function enablePlanMode(ctx: ExtensionContext): void {
    if (planModeEnabled) return
    planModeEnabled = true
    previousTools = pi.getActiveTools()
    pi.setActiveTools(PLAN_MODE_TOOLS)
    ctx.ui.notify('pi-constell-plan enabled. Only the active plan file is writable.', 'info')
    updateStatus(ctx)
    persistState()
  }

  function disablePlanMode(ctx: ExtensionContext): void {
    if (!planModeEnabled) return
    planModeEnabled = false
    pi.setActiveTools(previousTools ?? FALLBACK_NORMAL_TOOLS)
    previousTools = null
    ctx.ui.notify('pi-constell-plan disabled.', 'info')
    updateStatus(ctx)
    persistState()
  }

  function togglePlanMode(ctx: ExtensionContext): void {
    if (planModeEnabled) disablePlanMode(ctx)
    else enablePlanMode(ctx)
  }

  pi.registerCommand('plan', {
    description: 'Toggle pi-constell-plan mode',
    handler: async (_args, ctx) => togglePlanMode(ctx),
  })

  pi.registerCommand('plan-save', {
    description: 'Show the active or last saved plan path',
    handler: async (_args, ctx) => {
      const target = activePlanPath ?? lastSavedPath
      ctx.ui.notify(target ? `Plan file: ${target}` : 'No plan file has been created yet.', 'info')
    },
  })

  pi.on('tool_call', async (event, ctx) => {
    if (!planModeEnabled) return

    if (event.toolName === 'bash') {
      const command = String(event.input.command ?? '')
      if (!isSafeCommand(command)) {
        return {
          block: true,
          reason: `pi-constell-plan only allows read-only shell commands in plan mode. Blocked: ${command}`,
        }
      }
      return
    }

    if (event.toolName === 'write' || event.toolName === 'edit') {
      const rawPath = String(event.input.path ?? '')
      if (!rawPath) {
        return { block: true, reason: 'Plan mode writes require an active plan file path.' }
      }
      if (!activePlanPath) {
        return { block: true, reason: 'Plan mode has not allocated an active plan file yet.' }
      }

      const requestedPath = resolvePlanToolPath(ctx.cwd, rawPath)
      const allowedPath = resolvePlanToolPath(ctx.cwd, activePlanPath)
      if (requestedPath !== allowedPath) {
        return {
          block: true,
          reason: `Plan mode only allows edits to the active plan file: ${activePlanPath}`,
        }
      }
    }
  })

  pi.on('before_agent_start', async (event, ctx) => {
    if (!planModeEnabled) return

    lastPrompt = event.prompt
    activePlanPath = await ensureActivePlanPath(ctx.cwd, { prompt: lastPrompt, clarifications: lastClarifications }, activePlanPath)
    const planContent = activePlanPath ? await readPlanFile(activePlanPath) : null

    persistState()
    updateStatus(ctx)

    return {
      message: {
        customType: 'pi-constell-plan-mode',
        content: `[PI CONSTELL PLAN MODE ACTIVE]\nYou are in plan mode.\n\nRules:\n- Investigate the codebase with read-only tools.\n- Ask clarifying questions with askUserQuestion when necessary.\n- You may use write/edit only for the active plan file: ${activePlanPath}\n- Do not modify any other project file.\n- Produce a concrete implementation plan in markdown with headings like \"## Goal\" and \"## Plan\".\n- Prefer a strong action-oriented title so the saved filename is useful documentation.\n\n${planContent ? `Current plan file contents:\n\n${planContent}` : 'The active plan file is empty; create or refine it as needed.'}`,
        display: false,
      },
    }
  })

  pi.on('agent_end', async (event, ctx) => {
    await notifyConstellagent().catch(() => {})
    if (!planModeEnabled) return

    const clarificationSummary = extractLatestClarifications(event.messages)
    if (clarificationSummary) lastClarifications = clarificationSummary

    const lastAssistant = [...event.messages].reverse().find(isAssistantMessage)
    if (!lastAssistant) return

    const text = getTextContent(lastAssistant).trim()
    if (!text || text === lastSavedText) return

    const saved = await savePlanFile(ctx.cwd, text, currentModelId(ctx), {
      prompt: lastPrompt,
      clarifications: lastClarifications,
    }, activePlanPath).catch(() => null)

    if (!saved) return

    activePlanPath = saved.path
    lastSavedPath = saved.path
    lastSavedText = text
    updateStatus(ctx)
    persistState()
    ctx.ui.notify(`pi-constell-plan saved plan: ${saved.path}`, 'info')
  })

  pi.on('session_start', async (_event, ctx) => {
    if (pi.getFlag('plan') === true) planModeEnabled = true

    const stateEntry = ctx.sessionManager.getEntries()
      .filter((entry: { type: string; customType?: string }) => entry.type === 'custom' && entry.customType === STATE_TYPE)
      .pop() as { data?: PersistedState } | undefined

    if (stateEntry?.data) {
      planModeEnabled = stateEntry.data.enabled ?? planModeEnabled
      activePlanPath = stateEntry.data.activePlanPath ?? activePlanPath
      lastSavedPath = stateEntry.data.lastSavedPath ?? lastSavedPath
      lastSavedText = stateEntry.data.lastSavedText ?? lastSavedText
      lastPrompt = stateEntry.data.lastPrompt ?? lastPrompt
      lastClarifications = stateEntry.data.lastClarifications ?? lastClarifications
    }

    if (planModeEnabled) {
      previousTools = pi.getActiveTools()
      pi.setActiveTools(PLAN_MODE_TOOLS)
    }

    updateStatus(ctx)
  })
}
