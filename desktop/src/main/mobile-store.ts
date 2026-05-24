import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { createClient, type Client } from '@libsql/client'
import type {
  MobileCommand,
  MobileCommandStatus,
  MobileCommandType,
  MobileEvent,
  MobileEventType,
} from '@constellagent/mobile-protocol'
import { safeJsonStringify } from '../shared/json-safe'

type PolicyResult = MobileCommand['policyResult']

export interface CreateMobileCommandInput {
  readonly deviceId: string
  readonly type: MobileCommandType
  readonly payload: Record<string, unknown>
  readonly policyResult: PolicyResult
  readonly status?: MobileCommandStatus
  readonly error?: string
}

export interface AppendMobileEventInput {
  readonly type: MobileEventType
  readonly workspaceId?: string
  readonly sessionId?: string
  readonly payload?: Record<string, unknown>
}

export class MobileStore {
  private client: Client | null = null
  private ready: Promise<void> | null = null

  private ensure(): Promise<void> {
    if (!this.ready) {
      const dbPath = join(app.getPath('userData'), 'mobile-access.db')
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
        `CREATE TABLE IF NOT EXISTS mobile_devices (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          token_hash TEXT,
          public_key TEXT,
          created_at TEXT NOT NULL,
          last_seen_at TEXT,
          revoked_at TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS mobile_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          workspace_id TEXT,
          session_id TEXT,
          payload_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS mobile_commands (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          type TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL,
          policy_result TEXT NOT NULL,
          created_at TEXT NOT NULL,
          claimed_at TEXT,
          completed_at TEXT,
          error TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS mobile_audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT,
          action TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_mobile_events_id ON mobile_events(id)`,
        `CREATE INDEX IF NOT EXISTS idx_mobile_commands_status ON mobile_commands(status, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_mobile_audit_created ON mobile_audit_events(created_at)`,
      ],
      'write',
    )
  }

  async appendEvent(input: AppendMobileEventInput): Promise<MobileEvent> {
    await this.ensure()
    const createdAt = new Date().toISOString()
    const payload = input.payload ?? {}
    const result = await this.client?.execute({
      sql: `INSERT INTO mobile_events (type, workspace_id, session_id, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        input.type,
        input.workspaceId ?? null,
        input.sessionId ?? null,
        safeJsonStringify(payload),
        createdAt,
      ],
    })
    return {
      id: Number(result?.lastInsertRowid ?? 0),
      type: input.type,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      payload,
      createdAt,
    }
  }

  async listEvents(sinceId = 0, limit = 250): Promise<MobileEvent[]> {
    await this.ensure()
    const boundedLimit = Math.max(1, Math.min(1000, Math.floor(limit)))
    const result = await this.client?.execute({
      sql: `SELECT * FROM mobile_events WHERE id > ? ORDER BY id ASC LIMIT ?`,
      args: [Math.max(0, Math.floor(sinceId)), boundedLimit],
    })
    return (result?.rows ?? []).map(rowToEvent)
  }

  async createCommand(input: CreateMobileCommandInput): Promise<MobileCommand> {
    await this.ensure()
    const id = `cmd_${randomUUID()}`
    const createdAt = new Date().toISOString()
    const payload = input.payload ?? {}
    const status = input.status ?? 'pending'
    await this.client?.execute({
      sql: `INSERT INTO mobile_commands
              (id, device_id, type, payload_json, status, policy_result, created_at, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.deviceId,
        input.type,
        safeJsonStringify(payload),
        status,
        input.policyResult,
        createdAt,
        input.error ?? null,
      ],
    })
    await this.addAuditEvent(input.deviceId, `command.${status}`, {
      commandId: id,
      type: input.type,
      policyResult: input.policyResult,
    })
    return {
      id,
      deviceId: input.deviceId,
      type: input.type,
      payload,
      status,
      policyResult: input.policyResult,
      createdAt,
      ...(input.error ? { error: input.error } : {}),
    }
  }

  async addAuditEvent(
    deviceId: string | null,
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.ensure()
    await this.client?.execute({
      sql: `INSERT INTO mobile_audit_events (device_id, action, payload_json, created_at)
            VALUES (?, ?, ?, ?)`,
      args: [deviceId, action, safeJsonStringify(payload), new Date().toISOString()],
    })
  }

  async close(): Promise<void> {
    const client = this.client
    this.client = null
    this.ready = null
    client?.close()
  }
}

function rowToEvent(row: Record<string, unknown>): MobileEvent {
  return {
    id: Number(row.id ?? 0),
    type: String(row.type) as MobileEventType,
    ...(typeof row.workspace_id === 'string' && row.workspace_id
      ? { workspaceId: row.workspace_id }
      : {}),
    ...(typeof row.session_id === 'string' && row.session_id
      ? { sessionId: row.session_id }
      : {}),
    payload: parseJsonObject(row.payload_json),
    createdAt: String(row.created_at),
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return {}
  }
  return {}
}
