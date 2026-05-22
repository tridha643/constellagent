import { app } from 'electron'
import { join } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import type { TranscriptMessage } from '../shared/pi/pi-desktop-state'
import type { AgentProvider } from './agents/agent-driver'
import type { ThinkingLevel } from '../shared/conductor-thinking'
import { normalizeThinkingLevel } from '../shared/conductor-thinking'
import type { AgentChatSessionState, QueuedAgentMessage } from '../shared/agent-chat-types'
import { safeJsonStringify } from '../shared/json-safe'
import { parseQueuedMessagesJson } from './agent-chat-queue'

export interface StoredSession {
  readonly sessionId: string
  readonly workspaceId: string
  readonly workspacePath: string
  readonly title: string
  readonly provider: AgentProvider
  readonly model: string
  readonly thinkingLevel: ThinkingLevel
  readonly plan: boolean
  readonly status: 'idle' | 'running' | 'failed'
  readonly runPhase?: AgentChatSessionState['runPhase']
  readonly blockingQuestion?: AgentChatSessionState['blockingQuestion']
  readonly queuedMessages: readonly QueuedAgentMessage[]
  readonly error?: string
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * Plain standalone SQLite database (a single file under userData) for Conductor
 * chat session metadata + transcripts. Kept separate from AgentFS so this view
 * owns its own storage; transcripts are serialized as JSON blobs.
 */
export class AgentChatStore {
  private client: Client | null = null
  private ready: Promise<void> | null = null

  private ensure(): Promise<void> {
    if (!this.ready) {
      const dbPath = join(app.getPath('userData'), 'conductor-chat.db')
      this.client = createClient({ url: `file:${dbPath}` })
      this.ready = this.migrate()
    }
    return this.ready
  }

  private async migrate(): Promise<void> {
    const client = this.client
    if (!client) return
    await client.batch(
      [
        `CREATE TABLE IF NOT EXISTS sessions (
          session_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          workspace_path TEXT NOT NULL,
          title TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          plan INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'idle',
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS transcripts (
          session_id TEXT PRIMARY KEY,
          json TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id, updated_at DESC)`,
      ],
      'write',
    )
    await this.addThinkingLevelColumn()
    await this.addQueuedMessagesColumn()
  }

  private async addQueuedMessagesColumn(): Promise<void> {
    const client = this.client
    if (!client) return
    try {
      await client.execute(
        `ALTER TABLE sessions ADD COLUMN queued_messages_json TEXT NOT NULL DEFAULT '[]'`,
      )
    } catch {
      // Column already exists — idempotent migration.
    }
  }

  private async addThinkingLevelColumn(): Promise<void> {
    const client = this.client
    if (!client) return
    try {
      await client.execute(`ALTER TABLE sessions ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'low'`)
    } catch {
      // Column already exists — idempotent migration.
    }
  }

  async upsertSession(session: StoredSession): Promise<void> {
    await this.ensure()
    await this.client?.execute({
      sql: `INSERT INTO sessions
              (session_id, workspace_id, workspace_path, title, provider, model, thinking_level, plan, status, queued_messages_json, error, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              workspace_id = excluded.workspace_id,
              workspace_path = excluded.workspace_path,
              title = excluded.title,
              provider = excluded.provider,
              model = excluded.model,
              thinking_level = excluded.thinking_level,
              plan = excluded.plan,
              status = excluded.status,
              queued_messages_json = excluded.queued_messages_json,
              error = excluded.error,
              updated_at = excluded.updated_at`,
      args: [
        session.sessionId,
        session.workspaceId,
        session.workspacePath,
        session.title,
        session.provider,
        session.model,
        session.thinkingLevel,
        session.plan ? 1 : 0,
        session.status,
        safeJsonStringify(session.queuedMessages),
        session.error ?? null,
        session.createdAt,
        session.updatedAt,
      ],
    })
  }

  async listSessions(workspaceId: string): Promise<StoredSession[]> {
    await this.ensure()
    const result = await this.client?.execute({
      sql: `SELECT * FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC`,
      args: [workspaceId],
    })
    return (result?.rows ?? []).map(rowToSession)
  }

  async getSession(sessionId: string): Promise<StoredSession | null> {
    await this.ensure()
    const result = await this.client?.execute({
      sql: `SELECT * FROM sessions WHERE session_id = ?`,
      args: [sessionId],
    })
    const row = result?.rows?.[0]
    return row ? rowToSession(row) : null
  }

  async saveTranscript(sessionId: string, transcript: readonly TranscriptMessage[]): Promise<void> {
    await this.ensure()
    await this.client?.execute({
      sql: `INSERT INTO transcripts (session_id, json) VALUES (?, ?)
            ON CONFLICT(session_id) DO UPDATE SET json = excluded.json`,
      args: [sessionId, safeJsonStringify(transcript)],
    })
  }

  async loadTranscript(sessionId: string): Promise<TranscriptMessage[]> {
    await this.ensure()
    const result = await this.client?.execute({
      sql: `SELECT json FROM transcripts WHERE session_id = ?`,
      args: [sessionId],
    })
    const raw = result?.rows?.[0]?.json
    if (typeof raw !== 'string') return []
    try {
      return JSON.parse(raw) as TranscriptMessage[]
    } catch {
      return []
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.ensure()
    await this.client?.batch(
      [
        { sql: `DELETE FROM transcripts WHERE session_id = ?`, args: [sessionId] },
        { sql: `DELETE FROM sessions WHERE session_id = ?`, args: [sessionId] },
      ],
      'write',
    )
  }
}

function rowToSession(row: Record<string, unknown>): StoredSession {
  return {
    sessionId: String(row.session_id),
    workspaceId: String(row.workspace_id),
    workspacePath: String(row.workspace_path),
    title: String(row.title),
    provider: String(row.provider) as AgentProvider,
    model: String(row.model),
    thinkingLevel: normalizeThinkingLevel(
      row.thinking_level == null ? undefined : String(row.thinking_level),
    ),
    plan: Number(row.plan) === 1,
    status: String(row.status) as StoredSession['status'],
    queuedMessages: parseQueuedMessagesJson(row.queued_messages_json),
    error: row.error == null ? undefined : String(row.error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}
