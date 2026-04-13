import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { AssistantMessage, TextContent } from '@mariozechner/pi-ai'
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent'
import registerAskUserQuestion, { formatAskUserQuestionDetails, type AskUserQuestionDetails } from './ask-user-question.js'
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
  clarificationGateOpen: boolean
  lastClarifiedPrompt: string | null
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

  return toolResult?.details ? formatAskUserQuestionDetails(toolResult.details) : null
}

export default function piConstell(pi: ExtensionAPI): void {
  let planModeEnabled = false
  let previousTools: string[] | null = null
  let activePlanPath: string | null = null
  let lastSavedPath: string | null = null
  let lastSavedText: string | null = null
  let lastPrompt: string | null = null
  let lastClarifications: string | null = null
  let clarificationGateOpen = false
  let lastClarifiedPrompt: string | null = null

  registerAskUserQuestion(pi, {
    onComplete: async (details) => {
      if (!planModeEnabled) return
      const summary = formatAskUserQuestionDetails(details)
      if (!summary) return
      lastClarifications = summary
      lastClarifiedPrompt = lastPrompt
      clarificationGateOpen = true
      persistState()
    },
  })

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
      clarificationGateOpen,
      lastClarifiedPrompt,
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
    const gateLabel = clarificationGateOpen ? 'ready' : 'ask 1 question'
    ctx.ui.setStatus('pi-constell-plan', ctx.ui.theme.fg('warning', `⏸ PI Constell Plan → ${label} · ${gateLabel}`))
  }

  function enablePlanMode(ctx: ExtensionContext): void {
    if (planModeEnabled) return
    planModeEnabled = true
    previousTools = pi.getActiveTools()
    pi.setActiveTools(PLAN_MODE_TOOLS)
    ctx.ui.notify('pi-constell-plan enabled. Ask one clarifying question before the active plan file becomes writable.', 'info')
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
      if (!clarificationGateOpen) {
        return {
          block: true,
          reason: 'Plan mode requires a completed askUserQuestion clarification round before the active plan file can be written.',
        }
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

    const nextPrompt = event.prompt
    const promptChanged = nextPrompt !== lastPrompt
    lastPrompt = nextPrompt
    if (promptChanged || lastClarifiedPrompt !== lastPrompt) clarificationGateOpen = false

    const activeClarifications = clarificationGateOpen ? lastClarifications : null
    activePlanPath = await ensureActivePlanPath(ctx.cwd, { prompt: lastPrompt, clarifications: activeClarifications }, activePlanPath)
    const planContent = activePlanPath ? await readPlanFile(activePlanPath) : null

    persistState()
    updateStatus(ctx)

    return {
      message: {
        customType: 'pi-constell-plan-mode',
        content: `[PI CONSTELL PLAN MODE ACTIVE]\nYou are in plan mode.\n\nRules:\n- Investigate the repo with read-only tools before planning.\n- Your first substantive action must be askUserQuestion. Treat it as a blocking prerequisite before drafting or saving the plan.\n- Ask exactly one clarification question per askUserQuestion call, wait for the answer, and continue asking follow-ups one at a time until material ambiguities are resolved.\n- Prefer reading the codebase over asking the user when the answer is discoverable from the repo.\n- Each question should offer 2-4 strong options with concise tradeoffs, and include a recommended answer in the option descriptions when you have a strong default.\n- Until askUserQuestion completes successfully for this prompt, write/edit is blocked even for the active plan file.\n- You may use write/edit only for the active plan file: ${activePlanPath}\n- Do not modify any other project file.\n- Produce a concise markdown implementation plan with sections for \"## Open Questions / Assumptions\", \"## Proposed PR Stack\", per-phase validation details, and \"## Recommendation\".\n- For each planned phase, include: Goal, Why this is a good PR boundary, Main code areas likely to change, Unit tests, E2E validation, DB verification, and Linear.\n- After the plan is approved, execution should stop after phase 1 and wait for approval before PR creation or later phases.\n- Prefer a strong action-oriented title so the saved filename is useful documentation.\n\n${clarificationGateOpen ? `Clarification gate: satisfied for this prompt.\nLatest clarifications:\n${activeClarifications ?? 'None recorded.'}` : 'Clarification gate: pending. Ask one clarifying question with askUserQuestion before drafting the plan.'}\n\n${planContent ? `Current plan file contents:\n\n${planContent}` : 'The active plan file is empty; create or refine it as needed once the clarification gate is open.'}`,
        display: false,
      },
    }
  })

  pi.on('agent_end', async (event, ctx) => {
    await notifyConstellagent().catch(() => {})
    if (!planModeEnabled) return

    const clarificationSummary = extractLatestClarifications(event.messages)
    if (clarificationSummary) {
      lastClarifications = clarificationSummary
      lastClarifiedPrompt = lastPrompt
      clarificationGateOpen = true
    }

    const lastAssistant = [...event.messages].reverse().find(isAssistantMessage)
    if (!lastAssistant) return

    const text = getTextContent(lastAssistant).trim()
    if (!text || text === lastSavedText) return
    if (!clarificationGateOpen) {
      persistState()
      updateStatus(ctx)
      ctx.ui.notify('pi-constell-plan did not save this response because askUserQuestion must complete first.', 'warning')
      return
    }

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
      clarificationGateOpen = stateEntry.data.clarificationGateOpen ?? clarificationGateOpen
      lastClarifiedPrompt = stateEntry.data.lastClarifiedPrompt ?? lastClarifiedPrompt
    }

    if (planModeEnabled) {
      previousTools = pi.getActiveTools()
      pi.setActiveTools(PLAN_MODE_TOOLS)
    }

    updateStatus(ctx)
  })
}
