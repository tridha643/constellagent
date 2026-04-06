import { AgentFS } from 'agentfs-sdk'
import { join } from 'path'

const instances = new Map<string, AgentFS>()
const pending = new Map<string, Promise<AgentFS>>()

// Periodic WAL checkpoint interval (5 minutes)
const CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000
let checkpointTimer: ReturnType<typeof setInterval> | null = null

export async function getAgentFS(projectDir: string, sessionId?: string): Promise<AgentFS> {
  const key = sessionId ? `${projectDir}:${sessionId}` : projectDir
  if (instances.has(key)) return instances.get(key)!

  // Deduplicate concurrent initialization requests for the same key
  if (pending.has(key)) return pending.get(key)!

  const init = (async () => {
    const gitDir = join(projectDir, '.git')
    const dbPath = join(gitDir, `${sessionId || 'constellagent'}.db`)
    const agent = await AgentFS.open({ id: sessionId || 'constellagent', path: dbPath })

    instances.set(key, agent)
    // Start periodic WAL checkpoint timer when first instance is created
    startCheckpointTimer()
    return agent
  })()

  pending.set(key, init)
  try {
    return await init
  } finally {
    pending.delete(key)
  }
}

/**
 * Checkpoint WAL for a specific project's AgentFS database(s).
 * Uses PRAGMA wal_checkpoint(TRUNCATE) to compact the WAL and reclaim disk space.
 */
export async function checkpoint(projectDir: string): Promise<void> {
  for (const [key, agent] of instances) {
    if (key === projectDir || key.startsWith(`${projectDir}:`)) {
      try {
        const db = agent.getDatabase()
        await db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      } catch (err) {
        console.error(`agentfs: WAL checkpoint failed for ${key}`, err)
      }
    }
  }
}

/**
 * Checkpoint WAL for all open AgentFS instances.
 * Called periodically and on close to prevent unbounded WAL growth.
 */
export async function checkpointAll(): Promise<void> {
  for (const [key, agent] of instances) {
    try {
      const db = agent.getDatabase()
      await db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch (err) {
      console.error(`agentfs: WAL checkpoint failed for ${key}`, err)
    }
  }
}

/** Start the periodic WAL checkpoint timer (idempotent). */
export function startCheckpointTimer(): void {
  if (checkpointTimer) return
  checkpointTimer = setInterval(() => {
    checkpointAll().catch((err) => console.error('agentfs: periodic checkpoint error', err))
  }, CHECKPOINT_INTERVAL_MS)
  // Don't keep the process alive just for checkpointing
  if (checkpointTimer.unref) checkpointTimer.unref()
}

/** Stop the periodic WAL checkpoint timer. */
export function stopCheckpointTimer(): void {
  if (checkpointTimer) {
    clearInterval(checkpointTimer)
    checkpointTimer = null
  }
}

export async function closeAgentFS(projectDir: string): Promise<void> {
  // Checkpoint before closing to compact WAL
  await checkpoint(projectDir)
  for (const [key, agent] of instances) {
    if (key === projectDir || key.startsWith(`${projectDir}:`)) {
      await agent.close()
      instances.delete(key)
    }
  }
}

export async function closeAllAgentFS(): Promise<void> {
  stopCheckpointTimer()
  // Checkpoint all before closing to compact WAL
  await checkpointAll()
  for (const [key, agent] of instances) {
    await agent.close()
    instances.delete(key)
  }
}
