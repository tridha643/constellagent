import { randomUUID } from 'node:crypto'
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent'
import { loadTaskHandoff, readStoredPlanExcerpt } from './tasks/handoff.js'
import registerTasks from './tasks/register-tasks.js'

function currentModelId(ctx: ExtensionContext): string | null {
  return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null
}

export default function piConstellTasks(pi: ExtensionAPI): void {
  let taskSessionId = randomUUID()
  const taskController = registerTasks(pi, {
    resolveStoreContext: (ctx) => ({
      workspaceId: process.env.AGENT_ORCH_WS_ID?.trim() || null,
      sessionId: taskSessionId,
      cwd: ctx.cwd,
    }),
  })

  function ensureTaskToolsActive(): void {
    const activeTools = pi.getActiveTools()
    const nextTools = [...activeTools]
    for (const toolName of taskController.toolNames) {
      if (!nextTools.includes(toolName)) nextTools.push(toolName)
    }
    if (nextTools.length !== activeTools.length) pi.setActiveTools(nextTools)
  }

  pi.on('session_start', async (_event, ctx) => {
    ensureTaskToolsActive()
    await taskController.updateStatus(ctx)
  })

  pi.on('before_agent_start', async (_event, ctx) => {
    ensureTaskToolsActive()
    const workspaceId = process.env.AGENT_ORCH_WS_ID?.trim() || null
    const taskPrompt = await taskController.beforeAgentStart(ctx)
    const handoff = await loadTaskHandoff(workspaceId)
    const planExcerpt = handoff?.plan.path ? await readStoredPlanExcerpt(handoff.plan.path) : null

    const handoffLines = handoff
      ? [
          `Stored plan reference: ${handoff.plan.title} (${handoff.plan.path})`,
          `Seeded task graph: ${handoff.seed.taskCount} task(s) from ${handoff.seed.source}.`,
          handoff.seed.preservedExistingTasks ? 'Existing workspace tasks were preserved after the initial seed.' : null,
          planExcerpt ? `Stored plan excerpt:\n${planExcerpt}` : 'Stored plan excerpt unavailable; read the saved plan path directly if you need more detail.',
        ].filter(Boolean).join('\n\n')
      : null

    if (!taskPrompt && !handoffLines) return

    return {
      message: {
        customType: 'pi-constell-tasks-context',
        content: `[PI CONSTELL TASKS ACTIVE]\nYou are in implementation mode with the native workspace task extension enabled.\n\nRules:\n- Use the shared task graph to track implementation progress.\n- Keep task state synchronized with real execution status.\n- Read the stored plan reference before diverging from the seeded task graph.\n- Task persistence is allowed only under ~/.pi/<workspaceId>/tasks/.\n- Current model: ${currentModelId(ctx) ?? 'unknown'}\n\n${[handoffLines, taskPrompt].filter(Boolean).join('\n\n')}`,
        display: false,
      },
    }
  })
}
