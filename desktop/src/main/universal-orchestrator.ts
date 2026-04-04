import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText } from 'ai'
import { IPC } from '../shared/ipc-channels'
import type {
  OrchestratorStatus,
  OrchestratorMessage,
  OrchestratorSession,
  OrchestratorLlmCredentials,
} from '../shared/orchestrator-types'
import { DEFAULT_ORCHESTRATOR_MODEL } from '../shared/orchestrator-types'
import type { Settings } from '../renderer/store/types'
import type { SendBlueService } from './sendblue-service'
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestrator/orchestrator-system-prompt'

interface TaskPlan {
  tasks: Array<{
    title: string
    description: string
    suggested_branch_name: string
  }>
  message?: string
}

export class UniversalOrchestratorService {
  private status: OrchestratorStatus = 'idle'
  private sessions: OrchestratorSession[] = []
  private messages: OrchestratorMessage[] = []
  /** Used for SMS/webhook commands when the renderer does not send credentials. */
  private cachedLlm: OrchestratorLlmCredentials | null = null

  constructor(private sendBlueService: SendBlueService) {}

  /** Call after SendBlue starts so inbound SMS can use the same OpenRouter fields as Settings. */
  setCachedLlmFromSettings(settings: Pick<Settings, 'openRouterApiKey' | 'orchestratorModel'>): void {
    const model = settings.orchestratorModel.trim()
    this.cachedLlm = {
      openRouterApiKey: settings.openRouterApiKey,
      orchestratorModel: model || DEFAULT_ORCHESTRATOR_MODEL,
    }
  }

  async handleCommand(
    from: string,
    command: string,
    llm?: OrchestratorLlmCredentials | null,
  ): Promise<void> {
    const inboundMsg: OrchestratorMessage = {
      id: randomUUID(),
      direction: from === 'ui' ? 'outbound' : 'inbound',
      content: command,
      timestamp: Date.now(),
    }
    this.messages.push(inboundMsg)
    this.broadcast(IPC.ORCHESTRATOR_MESSAGE_RECEIVED, inboundMsg)

    const creds = from === 'ui' ? llm : this.cachedLlm
    const apiKey = (creds?.openRouterApiKey ?? '').trim()
    const modelId = (creds?.orchestratorModel ?? '').trim() || DEFAULT_ORCHESTRATOR_MODEL

    if (!apiKey) {
      this.status = 'error'
      this.broadcast(IPC.ORCHESTRATOR_STATUS_CHANGED, this.status)
      const errMsg: OrchestratorMessage = {
        id: randomUUID(),
        direction: 'system',
        content:
          'OpenRouter API key is required for the orchestrator. Add it under Settings → Orchestrator (OpenRouter).',
        timestamp: Date.now(),
      }
      this.messages.push(errMsg)
      this.broadcast(IPC.ORCHESTRATOR_MESSAGE_RECEIVED, errMsg)
      await this.sendSmsReply(from, errMsg.content, 'error')
      return
    }

    this.status = 'running'
    this.broadcast(IPC.ORCHESTRATOR_STATUS_CHANGED, this.status)

    try {
      const plan = await this.parseCommand(command, apiKey, modelId)

      const ackMessage = plan.message || `Received: "${command}". Creating ${plan.tasks.length} task(s).`
      const ackMsg: OrchestratorMessage = {
        id: randomUUID(),
        direction: 'system',
        content: ackMessage,
        timestamp: Date.now(),
      }
      this.messages.push(ackMsg)
      this.broadcast(IPC.ORCHESTRATOR_MESSAGE_RECEIVED, ackMsg)

      await this.sendSmsReply(from, ackMessage, 'acknowledgment')

      for (const task of plan.tasks) {
        const session: OrchestratorSession = {
          id: randomUUID(),
          workspaceId: '',
          worktreePath: '',
          branch: task.suggested_branch_name,
          task: task.description,
          status: 'pending',
          startedAt: Date.now(),
        }
        this.sessions.push(session)
        this.broadcast(IPC.ORCHESTRATOR_SESSION_UPDATED, session)
      }

      this.status = 'idle'
      this.broadcast(IPC.ORCHESTRATOR_STATUS_CHANGED, this.status)

      await this.sendSmsReply(
        from,
        `Tasks queued: ${plan.tasks.map((t) => t.title).join(', ')}`,
        'queued task summary',
      )
    } catch (err) {
      console.error('[orchestrator] Command failed:', err)
      this.status = 'error'
      this.broadcast(IPC.ORCHESTRATOR_STATUS_CHANGED, this.status)

      const errMsg: OrchestratorMessage = {
        id: randomUUID(),
        direction: 'system',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      }
      this.messages.push(errMsg)
      this.broadcast(IPC.ORCHESTRATOR_MESSAGE_RECEIVED, errMsg)
      await this.sendSmsReply(from, errMsg.content, 'error')
    }
  }

  private async parseCommand(command: string, apiKey: string, modelId: string): Promise<TaskPlan> {
    try {
      const openrouter = createOpenRouter({ apiKey })
      const model = openrouter(modelId)
      const { text } = await generateText({
        model,
        system: ORCHESTRATOR_SYSTEM_PROMPT,
        prompt: command,
      })

      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text]
      const parsed = JSON.parse(jsonMatch[1]!.trim())

      if (!Array.isArray(parsed.tasks)) {
        return {
          tasks: [{
            title: command.slice(0, 60),
            description: command,
            suggested_branch_name: `orchestrator/${command.slice(0, 30).replace(/\s+/g, '-').toLowerCase()}`,
          }],
          message: parsed.message,
        }
      }

      return parsed as TaskPlan
    } catch (err) {
      console.warn('[orchestrator] OpenRouter planning failed, using fallback:', err)
      return {
        tasks: [{
          title: command.slice(0, 60),
          description: command,
          suggested_branch_name: `orchestrator/${command.slice(0, 30).replace(/\s+/g, '-').toLowerCase()}`,
        }],
        message: `Task created: ${command}`,
      }
    }
  }

  getStatus(): OrchestratorStatus {
    return this.status
  }

  getSessions(): OrchestratorSession[] {
    return [...this.sessions]
  }

  getMessages(): OrchestratorMessage[] {
    return [...this.messages]
  }

  private broadcast(channel: string, data: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    }
  }

  private async sendSmsReply(from: string, message: string, label: string): Promise<void> {
    if (from === 'ui' || !this.sendBlueService.status().connected) {
      return
    }

    await this.sendBlueService.send(from, message).catch((err) => {
      console.error(`[orchestrator] Failed to send SMS ${label}:`, err)
    })
  }
}
