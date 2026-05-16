import { randomBytes } from 'crypto'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type { AutomationRunStartedEvent } from '../../shared/automation-types'
import {
  COMPOSIO_AUTOMATION_AGENT_GUARDRAILS,
  type ComposioAutomationDefinition,
} from '../../shared/composio-types'
import { buildAdHocAgentCommand } from '../../shared/plan-build-command'
import { PtyManager } from '../pty-manager'
import { GitService } from '../git-service'
import { trustPathForClaude } from '../claude-config'
import { summarizeComposioPayloadForAgent } from '../composio-payload'
import { lookupPersistedProjectByRepoPath } from '../persisted-state'

interface AutomationWindow extends Pick<BrowserWindow, 'isDestroyed' | 'webContents'> {}

interface AutomationRunnerDeps {
  getWindows?: () => AutomationWindow[]
}

function getElectronWindows(): AutomationWindow[] {
  const { BrowserWindow } = require('electron') as typeof import('electron')
  return BrowserWindow.getAllWindows()
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'composio'
}

function timestampSlug(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function buildAgentPrompt(definition: ComposioAutomationDefinition, composioPayload: unknown): string {
  const body = definition.instructions.trim()
  if (!body) {
    throw new Error(
      'This Composio automation has an empty prompt. Set it under Automations → Composio, then try again.',
    )
  }
  const eventBrief = summarizeComposioPayloadForAgent(composioPayload)
  const briefBlock = eventBrief.trim()
    ? `\n\n---\n\n${eventBrief}\n\n---\n`
    : ''
  return `${body}${briefBlock}\n\n${COMPOSIO_AUTOMATION_AGENT_GUARDRAILS}`
}

export class AutomationRunner {
  private readonly getWindows: () => AutomationWindow[]

  constructor(
    private readonly ptyManager: PtyManager,
    deps: AutomationRunnerDeps = {},
  ) {
    this.getWindows = deps.getWindows ?? getElectronWindows
  }

  async runComposioDefinition(definition: ComposioAutomationDefinition, payload: unknown): Promise<void> {
    const win = this.getWindows()[0]
    if (!win) throw new Error('No browser window available')

    const repoPath = definition.workspace || definition.repoPath
    const sanitized = sanitizeName(definition.name)
    const timestamp = timestampSlug()
    // Second-precision timestamps collide under burst Composio deliveries; extra entropy keeps paths unique.
    const uniq = randomBytes(3).toString('hex')
    const branch = `auto/${sanitized}/${timestamp}-${uniq}`
    const wtName = `auto-${sanitized}-${timestamp}-${uniq}`
    // Headless Composio runs can leave the same path behind (crash, duplicate trigger in one second).
    // Match UI "force" worktree creation: tear down an existing auto-* folder instead of failing WORKTREE_PATH_EXISTS.
    const worktreePath = await GitService.createWorktree(repoPath, wtName, branch, true, undefined, true)

    if (definition.agent === 'claude-code') {
      try {
        await trustPathForClaude(worktreePath)
      } catch {
        // Best-effort trust for fresh automation worktrees.
      }
    }

    const shell = process.env.SHELL || '/bin/zsh'
    const prompt = buildAgentPrompt(definition, payload)
    // autoApprove: headless trigger runs have no human at the terminal to click
    // permission/approval prompts (claude --dangerously-skip-permissions,
    // codex --dangerously-bypass-approvals-and-sandbox). Without this the agent
    // stalls waiting for input and the automation never finishes.
    const command = buildAdHocAgentCommand(definition.agent, null, prompt, { autoApprove: true }).command
    const ptyId = this.ptyManager.create(
      worktreePath,
      win.webContents,
      shell,
      undefined,
      `${command}\r`,
    )

    const anchorRepo = (definition.workspace || definition.repoPath || '').trim()
    let project = anchorRepo ? lookupPersistedProjectByRepoPath(anchorRepo) : null
    const altRepo = (definition.repoPath || '').trim()
    if (!project && altRepo && altRepo !== anchorRepo) {
      project = lookupPersistedProjectByRepoPath(altRepo)
    }

    const event: AutomationRunStartedEvent = {
      automationId: definition.id,
      automationName: definition.name,
      projectId: project?.id ?? '',
      repoPath: anchorRepo || altRepo || undefined,
      ptyId,
      worktreePath,
      branch,
      agentType: definition.agent,
    }
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.AUTOMATION_RUN_STARTED, event)
    }
  }
}
