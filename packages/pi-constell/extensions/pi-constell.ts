import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { AssistantMessage, TextContent } from '@mariozechner/pi-ai'
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent'
import { isSafeCommand, notifyConstellagent, savePlanFile } from './utils.js'

const PLAN_MODE_TOOLS = ['read', 'bash', 'grep', 'find', 'ls']
const STATE_TYPE = 'pi-constell-state'

interface PersistedState {
  enabled: boolean
  lastSavedPath: string | null
  lastSavedText: string | null
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

export default function piConstell(pi: ExtensionAPI): void {
  let planModeEnabled = false
  let previousTools: string[] | null = null
  let lastSavedPath: string | null = null
  let lastSavedText: string | null = null

  pi.registerFlag('plan', {
    description: 'Start in PI Constell plan mode (read-only exploration)',
    type: 'boolean',
    default: false,
  })

  function persistState() {
    pi.appendEntry(STATE_TYPE, {
      enabled: planModeEnabled,
      lastSavedPath,
      lastSavedText,
    } satisfies PersistedState)
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (planModeEnabled) {
      const pathLabel = lastSavedPath ? ` → ${lastSavedPath.split('/').slice(-2).join('/')}` : ''
      ctx.ui.setStatus('pi-constell', ctx.ui.theme.fg('warning', `⏸ PI Constell${pathLabel}`))
      return
    }
    ctx.ui.setStatus('pi-constell', undefined)
  }

  function togglePlanMode(ctx: ExtensionContext): void {
    planModeEnabled = !planModeEnabled
    if (planModeEnabled) {
      previousTools = pi.getActiveTools()
      pi.setActiveTools(PLAN_MODE_TOOLS)
      ctx.ui.notify('PI Constell plan mode enabled. Plans will be exported to .pi-constell/plans.', 'info')
    } else {
      pi.setActiveTools(previousTools ?? ['read', 'bash', 'edit', 'write'])
      previousTools = null
      ctx.ui.notify('PI Constell plan mode disabled.', 'info')
    }
    updateStatus(ctx)
    persistState()
  }

  pi.registerCommand('plan', {
    description: 'Toggle PI Constell plan mode',
    handler: async (_args, ctx) => togglePlanMode(ctx),
  })

  pi.registerCommand('plan-save', {
    description: 'Show the last saved PI Constell plan path',
    handler: async (_args, ctx) => {
      if (!lastSavedPath) {
        ctx.ui.notify('No PI Constell plan has been saved yet.', 'info')
        return
      }
      ctx.ui.notify(`Last PI Constell plan: ${lastSavedPath}`, 'info')
    },
  })

  pi.on('tool_call', async (event) => {
    if (!planModeEnabled || event.toolName !== 'bash') return

    const command = String(event.input.command ?? '')
    if (!isSafeCommand(command)) {
      return {
        block: true,
        reason: `PI Constell plan mode only allows read-only shell commands. Blocked: ${command}`,
      }
    }
  })

  pi.on('before_agent_start', async () => {
    if (!planModeEnabled) return

    return {
      message: {
        customType: 'pi-constell-plan-mode',
        content: `[PI CONSTELL PLAN MODE ACTIVE]\nYou are in read-only planning mode.\n\nRules:\n- Use only read-only investigation.\n- Do not modify files.\n- Produce a concrete implementation plan in markdown.\n- Include a clear title and a numbered Plan section.\n- Favor model-friendly markdown headings like \"## Goal\" and \"## Plan\".\n\nThe PI Constell extension will save the plan to .pi-constell/plans automatically when a valid plan is produced.`,
        display: false,
      },
    }
  })

  pi.on('agent_end', async (event, ctx) => {
    await notifyConstellagent().catch(() => {})

    if (!planModeEnabled) return

    const lastAssistant = [...event.messages].reverse().find(isAssistantMessage)
    if (!lastAssistant) return

    const text = getTextContent(lastAssistant).trim()
    if (!text || text === lastSavedText) return

    const saved = await savePlanFile(ctx.cwd, text, currentModelId(ctx)).catch(() => null)
    if (!saved) return

    lastSavedText = text
    lastSavedPath = saved.path
    updateStatus(ctx)
    persistState()
    ctx.ui.notify(`PI Constell saved plan: ${saved.path}`, 'success')
  })

  pi.on('session_start', async (_event, ctx) => {
    if (pi.getFlag('plan') === true) {
      planModeEnabled = true
    }

    const stateEntry = ctx.sessionManager.getEntries()
      .filter((entry: { type: string; customType?: string }) => entry.type === 'custom' && entry.customType === STATE_TYPE)
      .pop() as { data?: PersistedState } | undefined

    if (stateEntry?.data) {
      planModeEnabled = stateEntry.data.enabled ?? planModeEnabled
      lastSavedPath = stateEntry.data.lastSavedPath ?? lastSavedPath
      lastSavedText = stateEntry.data.lastSavedText ?? lastSavedText
    }

    if (planModeEnabled) {
      previousTools = pi.getActiveTools()
      pi.setActiveTools(PLAN_MODE_TOOLS)
    }
    updateStatus(ctx)
  })
}
