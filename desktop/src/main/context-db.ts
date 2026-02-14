import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

export class ContextDb {
  private db: Database.Database

  constructor(projectDir: string) {
    const dir = join(projectDir, '.constellagent')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    this.db = new Database(join(dir, 'context.db'))
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        agent_type TEXT NOT NULL DEFAULT 'claude-code',
        session_id TEXT,
        tool_name TEXT NOT NULL,
        tool_input TEXT,
        file_path TEXT,
        project_head TEXT,
        event_type TEXT,
        tool_response TEXT,
        timestamp TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
        tool_name, tool_input, file_path, tool_response,
        content='entries',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
        INSERT INTO entries_fts(rowid, tool_name, tool_input, file_path, tool_response)
        VALUES (new.id, new.tool_name, new.tool_input, new.file_path, new.tool_response);
      END;

      CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, tool_name, tool_input, file_path, tool_response)
        VALUES ('delete', old.id, old.tool_name, old.tool_input, old.file_path, old.tool_response);
      END;

      CREATE INDEX IF NOT EXISTS idx_entries_ws ON entries(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_entries_ts ON entries(timestamp);
    `)

    // Migrate existing databases: add columns introduced after initial schema
    const cols = this.db.prepare("PRAGMA table_info('entries')").all() as Array<{ name: string }>
    const colNames = new Set(cols.map((c) => c.name))
    if (!colNames.has('event_type')) {
      this.db.exec('ALTER TABLE entries ADD COLUMN event_type TEXT')
    }
    if (!colNames.has('tool_response')) {
      this.db.exec('ALTER TABLE entries ADD COLUMN tool_response TEXT')
    }

    // Rebuild FTS index to pick up any new columns (idempotent)
    try {
      this.db.exec("INSERT INTO entries_fts(entries_fts) VALUES('rebuild')")
    } catch { /* FTS rebuild is best-effort */ }
  }

  insert(entry: {
    workspaceId: string
    agentType?: string
    sessionId?: string
    toolName: string
    toolInput?: string
    filePath?: string
    projectHead?: string
    eventType?: string
    toolResponse?: string
    timestamp: string
  }) {
    this.db.prepare(`
      INSERT INTO entries (workspace_id, agent_type, session_id, tool_name, tool_input, file_path, project_head, event_type, tool_response, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.workspaceId,
      entry.agentType ?? 'claude-code',
      entry.sessionId ?? null,
      entry.toolName,
      entry.toolInput ?? null,
      entry.filePath ?? null,
      entry.projectHead ?? null,
      entry.eventType ?? null,
      entry.toolResponse ?? null,
      entry.timestamp,
    )
  }

  search(query: string, limit = 20): Array<{
    id: number
    workspaceId: string
    toolName: string
    toolInput: string
    filePath: string | null
    agentType: string
    projectHead: string | null
    eventType: string | null
    toolResponse: string | null
    timestamp: string
    rank: number
  }> {
    return this.db.prepare(`
      SELECT e.id, e.workspace_id as workspaceId, e.tool_name as toolName,
             e.tool_input as toolInput, e.file_path as filePath,
             e.agent_type as agentType, e.project_head as projectHead,
             e.event_type as eventType, e.tool_response as toolResponse,
             e.timestamp, rank
      FROM entries_fts
      JOIN entries e ON e.id = entries_fts.rowid
      WHERE entries_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as any[]
  }

  getRecent(workspaceId: string, limit = 50): Array<{
    id: number
    toolName: string
    toolInput: string
    filePath: string | null
    agentType: string
    projectHead: string | null
    eventType: string | null
    toolResponse: string | null
    timestamp: string
  }> {
    return this.db.prepare(`
      SELECT id, tool_name as toolName, tool_input as toolInput,
             file_path as filePath, agent_type as agentType,
             project_head as projectHead, event_type as eventType,
             tool_response as toolResponse, timestamp
      FROM entries
      WHERE workspace_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(workspaceId, limit) as any[]
  }

  getRecentAll(limit = 20): Array<{
    id: number
    toolName: string
    toolInput: string
    filePath: string | null
    agentType: string
    projectHead: string | null
    eventType: string | null
    toolResponse: string | null
    sessionId: string | null
    timestamp: string
  }> {
    return this.db.prepare(`
      SELECT id, tool_name as toolName, tool_input as toolInput,
             file_path as filePath, agent_type as agentType,
             project_head as projectHead, event_type as eventType,
             tool_response as toolResponse, session_id as sessionId,
             timestamp
      FROM entries
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as any[]
  }

  close() {
    this.db.close()
  }
}
