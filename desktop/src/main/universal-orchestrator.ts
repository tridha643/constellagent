import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { IPC } from '../shared/ipc-channels'
import type {
  OrchestratorStatus,
  OrchestratorMessage,
  OrchestratorSession,
} from '../shared/orchestrator-types'
import type { SendBlueService } from './sendblue-service'
import type { PtyManager } from './pty-manager'
import type { ContextDb } from './context-db'

interface TaskPlan {
  tasks: Array<{
    title: string
    description: string
    suggested_branch_name: string
  }>
  message?: string
}

const ORCHESTRATOR_SYSTEM_PROMPT = `You are a development orchestrator. Given a task description, you output a JSON plan with:
- A list of sub-tasks, each with: title, description, suggested_branch_name
- An optional message to send back to the user

Respond only with valid JSON matching this schema:
{
  "tasks": [{ "title": "string", "description": "string", "suggested_branch_name": "string" }],
  "message": "optional string"
}`

export class UniversalOrchestratorService {
  private status: OrchestratorStatus = 'idle'
  private sessions: OrchestratorSession[] = []
  private messages: OrchestratorMessage[] = []

  constructor(
    private ptyManager: PtyManager,
    private sendBlueService: SendBlueService,
  ) {}

  async handleCommand(from: string, command: string): Promise<void> {
    // Record inbound message
    const inboundMsg: OrchestratorMessage = {
      id: randomUUID(),
      direction: from === 'ui' ? 'outbound' : 'inbound',
      content: command,
      timestamp: Date.now(),
    }
    this.messages.push(inboundMsg)
    this.broadcast(IPC.ORCHESTRATOR_MESSAGE_RECEIVED, inboundMsg)

    this.status = 'running'
    this.broadcast(IPC.ORCHESTRATOR_STATUS_CHANGED, this.status)

    try {
      // Use Claude Code SDK (query) to parse the command into a task plan
      const plan = await this.parseCommand(command)

      // Send acknowledgment
      const ackMessage = plan.message || `Received: "${command}". Creating ${plan.tasks.length} task(s).`
      const ackMsg: OrchestratorMessage = {
        id: randomUUID(),
        direction: 'system',
        content: ackMessage,
        timestamp: Date.now(),
      }
      this.messages.push(ackMsg)
      this.broadcast(IPC.ORCHESTRATOR_MESSAGE_RECEIVED, ackMsg)

      // Notify sender via SendBlue if the command came from SMS
      if (from !== 'ui' && this.sendBlueService.status().connected) {
        await this.sendBlueService.send(from, ackMessage).catch((err) => {
          console.error('[orchestrator] Failed to send SMS acknowledgment:', err)
        })
      }

      // Create sessions for each task
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

      // Notify completion via SendBlue
      if (from !== 'ui' && this.sendBlueService.status().connected) {
        await this.sendBlueService.send(
          from,
          `Tasks queued: ${plan.tasks.map((t) => t.title).join(', ')}`
        ).catch(() => {})
      }
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
    }
  }

  private async parseCommand(command: string): Promise<TaskPlan> {
    // Use Claude Code SDK to parse the command into structured tasks
    try {
      const { query } = await import('@anthropic-ai/claude-code')
      const result: string[] = []
      for await (const msg of query({
        prompt: command,
        systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
        options: {
          maxTurns: 1,
        },
      })) {
        if (msg.type === 'result') {
          result.push(typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result))
        } else if (msg.type === 'assistant' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              result.push(block.text)
            }
          }
        }
      }

      const text = result.join('')
      // Extract JSON from the response (handle markdown code blocks)
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
      console.warn('[orchestrator] Claude Code SDK unavailable, using fallback:', err)
      // Fallback: create a single task from the command directly
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
}
