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
import { loadOrCreateMacIdentity, type LoadMacIdentityOptions } from './mobile-keychain'

export interface BridgeDeviceState {
  readonly macDeviceId: string
  readonly macIdentityPublicKey: string
  readonly macIdentityPrivateKey: string
  /** Map of phoneDeviceId → phoneIdentityPublicKey (base64). */
  readonly trustedPhones: Readonly<Record<string, string>>
}

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

export interface MobileStoreOptions {
  readonly dbPath?: string
  readonly keychainOptions?: LoadMacIdentityOptions
}

export class MobileStore {
  private client: Client | null = null
  private ready: Promise<void> | null = null
  private readonly explicitDbPath?: string
  private readonly keychainOptions?: LoadMacIdentityOptions

  constructor(options: MobileStoreOptions = {}) {
    this.explicitDbPath = options.dbPath
    this.keychainOptions = options.keychainOptions
  }

  private ensure(): Promise<void> {
    if (!this.ready) {
      const dbPath = this.explicitDbPath ?? join(app.getPath('userData'), 'mobile-access.db')
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
          revoked_at TEXT,
          trusted_at TEXT,
          last_pairing_session_id TEXT,
          phone_identity_public_key TEXT
        )`,
        // Public-only table; the matching private key lives in Electron safeStorage
        // (Keychain on macOS). Never persist private material here.
        `CREATE TABLE IF NOT EXISTS mobile_bridge_identity (
          mac_device_id TEXT PRIMARY KEY,
          mac_identity_public_key TEXT NOT NULL,
          created_at TEXT NOT NULL
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
    // Idempotent column adds for pre-existing mobile_devices tables (libSQL
    // has no ADD COLUMN IF NOT EXISTS; swallow the duplicate-column error).
    await this.addColumnIfMissing('mobile_devices', 'trusted_at', 'TEXT')
    await this.addColumnIfMissing('mobile_devices', 'last_pairing_session_id', 'TEXT')
    await this.addColumnIfMissing('mobile_devices', 'phone_identity_public_key', 'TEXT')
  }

  private async addColumnIfMissing(table: string, column: string, type: string): Promise<void> {
    try {
      await this.client?.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    } catch (error) {
      const message = (error as { message?: string } | null)?.message ?? ''
      if (!/duplicate column/i.test(message)) {
        // Surface non-duplicate errors so genuine corruption isn't masked.
        throw error
      }
    }
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

  // Loads (or bootstraps) the durable bridge identity. The public key + opaque
  // mac device id live in SQLite; the matching Ed25519 private key is loaded
  // from Electron safeStorage via mobile-keychain.ts.
  async loadOrCreateBridgeDeviceState(): Promise<BridgeDeviceState> {
    await this.ensure()
    const identity = loadOrCreateMacIdentity(this.keychainOptions)

    const existing = await this.client?.execute({
      sql: `SELECT mac_device_id, mac_identity_public_key FROM mobile_bridge_identity LIMIT 1`,
      args: [],
    })
    let macDeviceId: string
    if (existing && existing.rows.length > 0) {
      const row = existing.rows[0]!
      macDeviceId = String(row.mac_device_id)
      const storedPublicKey = String(row.mac_identity_public_key)
      if (storedPublicKey !== identity.publicKeyBase64) {
        // safeStorage produced a new keypair (likely a freshly generated
        // fallback file) — refresh the public key row so phones see the new id.
        await this.client?.execute({
          sql: `UPDATE mobile_bridge_identity
                  SET mac_identity_public_key = ?
                WHERE mac_device_id = ?`,
          args: [identity.publicKeyBase64, macDeviceId],
        })
      }
    } else {
      macDeviceId = randomUUID()
      await this.client?.execute({
        sql: `INSERT INTO mobile_bridge_identity
                (mac_device_id, mac_identity_public_key, created_at)
              VALUES (?, ?, ?)`,
        args: [macDeviceId, identity.publicKeyBase64, new Date().toISOString()],
      })
    }

    const trusted = await this.listTrustedPhones()
    return {
      macDeviceId,
      macIdentityPublicKey: identity.publicKeyBase64,
      macIdentityPrivateKey: identity.privateKeyBase64,
      trustedPhones: trusted,
    }
  }

  async listTrustedPhones(): Promise<Record<string, string>> {
    await this.ensure()
    const result = await this.client?.execute({
      sql: `SELECT id, phone_identity_public_key FROM mobile_devices
             WHERE phone_identity_public_key IS NOT NULL
               AND revoked_at IS NULL`,
      args: [],
    })
    const out: Record<string, string> = {}
    for (const row of result?.rows ?? []) {
      const phoneId = typeof row.id === 'string' ? row.id : ''
      const pub = typeof row.phone_identity_public_key === 'string'
        ? row.phone_identity_public_key
        : ''
      if (phoneId && pub) out[phoneId] = pub
    }
    return out
  }

  async getTrustedPhonePublicKey(phoneDeviceId: string): Promise<string | null> {
    if (!phoneDeviceId) return null
    await this.ensure()
    const result = await this.client?.execute({
      sql: `SELECT phone_identity_public_key FROM mobile_devices
             WHERE id = ? AND revoked_at IS NULL LIMIT 1`,
      args: [phoneDeviceId],
    })
    const row = result?.rows?.[0]
    const pub = row && typeof row.phone_identity_public_key === 'string'
      ? row.phone_identity_public_key
      : ''
    return pub || null
  }

  async rememberTrustedPhone(
    phoneDeviceId: string,
    phoneIdentityPublicKey: string,
    options: { sessionId?: string; name?: string } = {},
  ): Promise<void> {
    if (!phoneDeviceId || !phoneIdentityPublicKey) return
    await this.ensure()
    const now = new Date().toISOString()
    // Upsert by primary key (id). Keep token_hash null — this row is gated on
    // its Ed25519 identity public key, not a bearer token.
    await this.client?.execute({
      sql: `INSERT INTO mobile_devices
              (id, name, public_key, phone_identity_public_key,
               trusted_at, last_pairing_session_id, created_at, last_seen_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              phone_identity_public_key = excluded.phone_identity_public_key,
              public_key = excluded.public_key,
              trusted_at = excluded.trusted_at,
              last_pairing_session_id = excluded.last_pairing_session_id,
              last_seen_at = excluded.last_seen_at,
              revoked_at = NULL`,
      args: [
        phoneDeviceId,
        options.name ?? 'iPhone',
        phoneIdentityPublicKey,
        phoneIdentityPublicKey,
        now,
        options.sessionId ?? null,
        now,
        now,
      ],
    })
    await this.addAuditEvent(phoneDeviceId, 'device.trusted', {
      sessionId: options.sessionId ?? null,
    })
  }

  async revokeTrustedPhone(phoneDeviceId: string): Promise<void> {
    if (!phoneDeviceId) return
    await this.ensure()
    await this.client?.execute({
      sql: `UPDATE mobile_devices SET revoked_at = ? WHERE id = ?`,
      args: [new Date().toISOString(), phoneDeviceId],
    })
    await this.addAuditEvent(phoneDeviceId, 'device.revoked')
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
