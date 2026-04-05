import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { AutomationAgentType, AutomationEvent } from '../shared/automation-types'
import {
  DEFAULT_ACTIVITY_DIR,
  CLAUDE_MARKER_SUFFIX,
  CODEX_MARKER_SEGMENT,
  GEMINI_MARKER_SEGMENT,
  CURSOR_MARKER_SEGMENT,
  OPENCODE_MARKER_SEGMENT,
} from '../shared/agent-markers'
import { lookupPersistedWorkspace } from './persisted-state'

const DEFAULT_NOTIFY_DIR = '/tmp/constellagent-notify'
const POLL_INTERVAL = 500
const FILE_SETTLE_MS = 100

interface ActivityEntry {
  wsId: string
  agentType: AutomationAgentType
}

export class NotificationWatcher {
  onNotify?: (workspaceId: string) => void
  onAgentLifecycleEvent?: (event: AutomationEvent) => void

  constructor(
    private readonly notifyDir = process.env.CONSTELLAGENT_NOTIFY_DIR || DEFAULT_NOTIFY_DIR,
    private readonly activityDir = process.env.CONSTELLAGENT_ACTIVITY_DIR || DEFAULT_ACTIVITY_DIR,
  ) {}

  private timer: ReturnType<typeof setInterval> | null = null
  private lastActiveAgents = new Map<string, Set<AutomationAgentType>>()

  start(): void {
    mkdirSync(this.notifyDir, { recursive: true })
    mkdirSync(this.activityDir, { recursive: true })
    this.pollOnce()
    this.timer = setInterval(() => this.pollOnce(), POLL_INTERVAL)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private pollOnce(): void {
    this.pollNotifications()
    this.pollActivity()
  }

  private pollNotifications(): void {
    try {
      const files = readdirSync(this.notifyDir)
      const now = Date.now()
      for (const f of files) {
        // Ignore in-progress temp files written by atomic-writer hooks.
        if (f.endsWith('.tmp')) continue
        const filePath = join(this.notifyDir, f)
        try {
          const stat = statSync(filePath)
          // Avoid reading files while writers may still be flushing content.
          if (now - stat.mtimeMs < FILE_SETTLE_MS) continue
        } catch {
          continue
        }
        this.processFile(filePath)
      }
    } catch {
      // Directory may not exist yet
    }
  }

  private pollActivity(): void {
    try {
      const files = readdirSync(this.activityDir)
      const nextActiveAgents = new Map<string, Set<AutomationAgentType>>()
      for (const name of files) {
        const entry = this.workspaceIdFromMarkerName(name)
        if (!entry) {
          this.removeActivityMarker(name)
          continue
        }
        const set = nextActiveAgents.get(entry.wsId) ?? new Set<AutomationAgentType>()
        set.add(entry.agentType)
        nextActiveAgents.set(entry.wsId, set)
      }
      const entries: ActivityEntry[] = Array.from(nextActiveAgents.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([wsId, agentTypes]) => Array.from(agentTypes).sort().map((agentType) => ({ wsId, agentType })))

      if (!this.activityMapsEqual(this.lastActiveAgents, nextActiveAgents)) {
        const becameInactive = Array.from(this.lastActiveAgents.keys()).filter((id) => !nextActiveAgents.has(id))

        this.emitLifecycleEvents(this.lastActiveAgents, nextActiveAgents)
        this.lastActiveAgents = nextActiveAgents
        this.sendActivity(entries)

        // Fallback completion signal: if a workspace was active and now is not,
        // emit a notify event so renderer can show unread attention dots even
        // when explicit notify files are missed.
        for (const wsId of becameInactive) {
          this.notifyRenderer(wsId)
        }
      }
    } catch {
      if (this.lastActiveAgents.size > 0) {
        const prevIds = Array.from(this.lastActiveAgents.keys())
        this.emitLifecycleEvents(this.lastActiveAgents, new Map())
        this.lastActiveAgents = new Map()
        this.sendActivity([])
        for (const wsId of prevIds) {
          this.notifyRenderer(wsId)
        }
      }
    }
  }

  private processFile(filePath: string): void {
    try {
      const wsId = readFileSync(filePath, 'utf-8').trim()
      if (!wsId) {
        unlinkSync(filePath)
        return
      }
      this.notifyRenderer(wsId)
      unlinkSync(filePath)
    } catch {
      // File may have been already processed or deleted
    }
  }

  private workspaceIdFromMarkerName(name: string): ActivityEntry | null {
    const marker = name.trim()
    if (!marker) return null

    if (marker.endsWith(CLAUDE_MARKER_SUFFIX)) {
      const wsId = marker.slice(0, -CLAUDE_MARKER_SUFFIX.length)
      return wsId ? { wsId, agentType: 'claude-code' } : null
    }

    const codexIdx = marker.indexOf(CODEX_MARKER_SEGMENT)
    if (codexIdx > 0) {
      const wsId = marker.slice(0, codexIdx)
      return wsId ? { wsId, agentType: 'codex' } : null
    }

    const geminiIdx = marker.indexOf(GEMINI_MARKER_SEGMENT)
    if (geminiIdx > 0) {
      const wsId = marker.slice(0, geminiIdx)
      return wsId ? { wsId, agentType: 'gemini' } : null
    }

    const cursorIdx = marker.indexOf(CURSOR_MARKER_SEGMENT)
    if (cursorIdx > 0) {
      const wsId = marker.slice(0, cursorIdx)
      return wsId ? { wsId, agentType: 'cursor' } : null
    }

    const opencodeIdx = marker.indexOf(OPENCODE_MARKER_SEGMENT)
    if (opencodeIdx > 0) {
      const wsId = marker.slice(0, opencodeIdx)
      return wsId ? { wsId, agentType: 'opencode' } : null
    }

    return null
  }

  private removeActivityMarker(name: string): void {
    try {
      unlinkSync(join(this.activityDir, name))
    } catch {
      // Marker may already be gone
    }
  }

  private notifyRenderer(workspaceId: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.CLAUDE_NOTIFY_WORKSPACE, workspaceId)
      }
    }
    this.onNotify?.(workspaceId)
  }

  private sendActivity(entries: ActivityEntry[]): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.CLAUDE_ACTIVITY_UPDATE, entries)
      }
    }
  }

  private activityMapsEqual(
    left: Map<string, Set<AutomationAgentType>>,
    right: Map<string, Set<AutomationAgentType>>,
  ): boolean {
    if (left.size !== right.size) return false
    for (const [wsId, leftSet] of left.entries()) {
      const rightSet = right.get(wsId)
      if (!rightSet || leftSet.size !== rightSet.size) return false
      for (const agentType of leftSet) {
        if (!rightSet.has(agentType)) return false
      }
    }
    return true
  }

  private emitLifecycleEvents(
    previous: Map<string, Set<AutomationAgentType>>,
    next: Map<string, Set<AutomationAgentType>>,
  ): void {
    for (const [wsId, nextAgentTypes] of next.entries()) {
      const previousAgentTypes = previous.get(wsId) ?? new Set<AutomationAgentType>()
      for (const agentType of nextAgentTypes) {
        if (!previousAgentTypes.has(agentType)) {
          this.emitLifecycleEvent('agent:started', wsId, agentType)
        }
      }
    }

    for (const [wsId, previousAgentTypes] of previous.entries()) {
      const nextAgentTypes = next.get(wsId) ?? new Set<AutomationAgentType>()
      for (const agentType of previousAgentTypes) {
        if (!nextAgentTypes.has(agentType)) {
          this.emitLifecycleEvent('agent:stopped', wsId, agentType)
        }
      }
    }
  }

  private emitLifecycleEvent(
    type: 'agent:started' | 'agent:stopped',
    workspaceId: string,
    agentType: AutomationAgentType,
  ): void {
    const metadata = lookupPersistedWorkspace(workspaceId)
    this.onAgentLifecycleEvent?.({
      type,
      timestamp: Date.now(),
      workspaceId,
      agentType,
      projectId: metadata.projectId,
      branch: metadata.branch,
    })
  }
}
