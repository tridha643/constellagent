import * as cron from 'node-cron'
import { exec as execCallback } from 'child_process'
import { promisify } from 'util'
import type { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  AutomationAction,
  AutomationConfigLike,
  AutomationConfigV2,
  AutomationEvent,
  AutomationFilter,
  AutomationRunStartedEvent,
  AutomationStatusEvent,
} from '../shared/automation-types'
import {
  DEFAULT_AUTOMATION_COOLDOWN_MS,
  MAX_AUTOMATION_EXECUTIONS_PER_MINUTE,
  toAutomationConfigV2,
} from '../shared/automation-types'
import { onAutomationEvent } from './automation-event-bus'
import { PtyManager } from './pty-manager'
import { GitService } from './git-service'
import { trustPathForClaude } from './claude-config'

const execAsync = promisify(execCallback)

type AutomationWindow = Pick<BrowserWindow, 'isDestroyed' | 'webContents'>

interface AutomationEngineDeps {
  getWindows?: () => AutomationWindow[]
  execShellCommand?: (command: string, cwd: string) => Promise<void>
  showNotification?: (title: string, body: string) => void
}

function getElectronWindows(): AutomationWindow[] {
  const { BrowserWindow } = require('electron') as typeof import('electron')
  return BrowserWindow.getAllWindows()
}

function showElectronNotification(title: string, body: string): void {
  const { Notification } = require('electron') as typeof import('electron')
  new Notification({ title, body }).show()
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function branchPatternToRegExp(pattern: string): RegExp {
  return new RegExp(`^${escapeRegExp(pattern).replace(/\\\*/g, '.*')}$`)
}

export class AutomationEngine {
  private configs = new Map<string, AutomationConfigV2>()
  private cronJobs = new Map<string, cron.ScheduledTask>()
  private lastFiredAt = new Map<string, number>()
  private recentExecutionStarts: number[] = []
  private unsubscribeEventBus: (() => void) | null = null
  private readonly getWindows: () => AutomationWindow[]
  private readonly execShellCommand: (command: string, cwd: string) => Promise<void>
  private readonly showNotification: (title: string, body: string) => void

  constructor(
    private readonly ptyManager: PtyManager,
    deps: AutomationEngineDeps = {},
  ) {
    this.getWindows = deps.getWindows ?? getElectronWindows
    this.execShellCommand = deps.execShellCommand ?? ((command, cwd) => execAsync(command, { cwd }).then(() => {}))
    this.showNotification = deps.showNotification ?? showElectronNotification
    this.unsubscribeEventBus = onAutomationEvent((event) => {
      void this.handleAutomationEvent(event)
    })
  }

  upsert(configInput: AutomationConfigLike): void {
    const config = toAutomationConfigV2(configInput)
    this.configs.set(config.id, config)
    this.unscheduleCron(config.id)
    if (!config.enabled) return
    if (config.trigger.type === 'cron') {
      const job = cron.schedule(config.trigger.cronExpression, () => {
        void this.executeAutomation(config, { triggerEvent: null })
      })
      this.cronJobs.set(config.id, job)
    }
  }

  remove(automationId: string): void {
    this.unscheduleCron(automationId)
    this.configs.delete(automationId)
    this.lastFiredAt.delete(automationId)
  }

  runNow(configInput: AutomationConfigLike): void {
    const config = toAutomationConfigV2(configInput)
    this.configs.set(config.id, config)
    void this.executeAutomation(config, { triggerEvent: null, ignoreEnabled: true, ignoreCooldown: true })
  }

  destroyAll(): void {
    for (const automationId of this.cronJobs.keys()) {
      this.unscheduleCron(automationId)
    }
    this.unsubscribeEventBus?.()
    this.unsubscribeEventBus = null
  }

  private unscheduleCron(automationId: string): void {
    const job = this.cronJobs.get(automationId)
    if (!job) return
    job.stop()
    this.cronJobs.delete(automationId)
  }

  private async handleAutomationEvent(event: AutomationEvent): Promise<void> {
    for (const config of this.configs.values()) {
      if (!config.enabled) continue
      if (config.trigger.type !== 'event') continue
      if (config.trigger.eventType !== event.type) continue
      if (event.meta?.automationOrigin === config.id) continue
      if (!this.matchesFilters(config.trigger.filters ?? [], event)) continue
      await this.executeAutomation(config, { triggerEvent: event })
    }
  }

  private matchesFilters(filters: AutomationFilter[], event: AutomationEvent): boolean {
    return filters.every((filter) => {
      switch (filter.field) {
        case 'agentType':
          return event.agentType === filter.value
        case 'branch':
          return Boolean(event.branch) && branchPatternToRegExp(filter.pattern).test(event.branch)
        case 'toolName':
          return event.toolName === filter.value
        case 'workspaceId':
          return event.workspaceId === filter.value
        default:
          return true
      }
    })
  }

  private canRunNow(config: AutomationConfigV2, ignoreCooldown: boolean): boolean {
    const now = Date.now()
    this.recentExecutionStarts = this.recentExecutionStarts.filter((timestamp) => now - timestamp < 60_000)
    if (this.recentExecutionStarts.length >= MAX_AUTOMATION_EXECUTIONS_PER_MINUTE) {
      console.warn(`[automations] Global automation rate limit reached, skipping ${config.id}`)
      return false
    }
    if (!ignoreCooldown) {
      const cooldownMs = config.cooldownMs ?? DEFAULT_AUTOMATION_COOLDOWN_MS
      const lastRun = this.lastFiredAt.get(config.id) ?? 0
      if (now - lastRun < cooldownMs) return false
    }
    this.recentExecutionStarts.push(now)
    this.lastFiredAt.set(config.id, now)
    return true
  }

  private async executeAutomation(
    config: AutomationConfigV2,
    options: {
      triggerEvent: AutomationEvent | null
      ignoreEnabled?: boolean
      ignoreCooldown?: boolean
    },
  ): Promise<void> {
    if (!options.ignoreEnabled && !config.enabled) return
    if (!this.canRunNow(config, options.ignoreCooldown ?? false)) return

    try {
      await this.executeAction(config, options.triggerEvent)
      this.broadcastStatus({
        automationId: config.id,
        status: 'success',
        timestamp: Date.now(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[automations] ${config.id} failed:`, err)
      this.broadcastStatus({
        automationId: config.id,
        status: 'failed',
        timestamp: Date.now(),
        message,
      })
    }
  }

  private async executeAction(config: AutomationConfigV2, triggerEvent: AutomationEvent | null): Promise<void> {
    const action = config.action
    switch (action.type) {
      case 'run-prompt':
        await this.executePromptRun(config, action.prompt)
        return
      case 'run-shell-command':
        await this.execShellCommand(action.command, config.repoPath)
        return
      case 'send-notification':
        this.showNotification(action.title, action.body)
        return
      case 'write-to-pty':
        this.executeWriteToPty(action)
        return
      default: {
        const exhaustiveCheck: never = action
        throw new Error(`Unsupported automation action: ${JSON.stringify(exhaustiveCheck)}`)
      }
    }
  }

  private executeWriteToPty(action: Extract<AutomationAction, { type: 'write-to-pty' }>): void {
    const ptyIds = this.ptyManager.getPtyIdsForWorkspace(action.workspaceId)
    const targetPtyId = ptyIds[ptyIds.length - 1]
    if (!targetPtyId) {
      throw new Error(`No live PTY found for workspace ${action.workspaceId}`)
    }
    this.ptyManager.write(targetPtyId, action.input)
  }

  private async executePromptRun(config: AutomationConfigV2, prompt: string): Promise<void> {
    const win = this.getWindows()[0]
    if (!win) {
      throw new Error('No browser window available')
    }

    const sanitized = config.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30)
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`

    const branch = `auto/${sanitized}/${timestamp}`
    const wtName = `auto-${sanitized}-${timestamp}`
    const worktreePath = await GitService.createWorktree(config.repoPath, wtName, branch, true)

    try {
      await trustPathForClaude(worktreePath)
    } catch {
      // Best-effort trust for fresh automation worktrees.
    }

    const shell = process.env.SHELL || '/bin/zsh'
    const escapedPrompt = prompt.replace(/'/g, "'\\''")
    const ptyId = this.ptyManager.create(
      worktreePath,
      win.webContents,
      shell,
      undefined,
      `claude '${escapedPrompt}'\r`,
    )

    const event: AutomationRunStartedEvent = {
      automationId: config.id,
      automationName: config.name,
      projectId: config.projectId,
      ptyId,
      worktreePath,
      branch,
    }
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.AUTOMATION_RUN_STARTED, event)
    }
  }

  private broadcastStatus(event: AutomationStatusEvent): void {
    for (const win of this.getWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.AUTOMATION_STATUS_UPDATED, event)
      }
    }
  }
}
