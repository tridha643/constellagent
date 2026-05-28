import { readdir, stat, realpath, open } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import type { ContextWindowData } from '../shared/context-window-types'

const TAIL_BYTES = 64 * 1024

interface CacheEntry {
  file: string
  mtimeMs: number
  size: number
  data: ContextWindowData | null
}

export class ContextWindowService {
  private cache = new Map<string, CacheEntry>()

  async getUsage(worktreePath: string): Promise<ContextWindowData | null> {
    try {
      const resolved = await realpath(worktreePath)
      const encoded = resolved.replace(/\//g, '-')
      const projectDir = join(homedir(), '.claude', 'projects', encoded)

      let entries: string[]
      try {
        entries = await readdir(projectDir)
      } catch {
        return null
      }
      const files = entries.filter((f) => f.endsWith('.jsonl'))
      if (files.length === 0) return null

      // Pick newest by mtime.
      let newest = ''
      let newestMtime = 0
      let newestSize = 0
      const stats = await Promise.all(
        files.map(async (f) => {
          const full = join(projectDir, f)
          try {
            const st = await stat(full)
            return { full, mtimeMs: st.mtimeMs, size: st.size }
          } catch {
            return null
          }
        }),
      )
      for (const s of stats) {
        if (!s) continue
        if (s.mtimeMs > newestMtime) {
          newestMtime = s.mtimeMs
          newest = s.full
          newestSize = s.size
        }
      }
      if (!newest) return null

      // If the newest session file is unchanged since the last poll, reuse the
      // cached parsed result rather than re-reading and re-parsing 64 KB of
      // JSONL on every 5 s poll. Cache is keyed by the input worktree path so
      // each open workspace gets its own entry.
      const cached = this.cache.get(worktreePath)
      if (
        cached &&
        cached.file === newest &&
        cached.mtimeMs === newestMtime &&
        cached.size === newestSize
      ) {
        return cached.data
      }

      const sessionId = newest.replace(/.*\//, '').replace('.jsonl', '')

      const data = await this.readTail(newest, newestSize, sessionId, newestMtime)
      this.cache.set(worktreePath, { file: newest, mtimeMs: newestMtime, size: newestSize, data })
      return data
    } catch {
      return null
    }
  }

  private async readTail(
    file: string,
    size: number,
    sessionId: string,
    newestMtime: number,
  ): Promise<ContextWindowData | null> {
    const handle = await open(file, 'r')
    try {
      const start = Math.max(0, size - TAIL_BYTES)
      const length = Math.min(size, TAIL_BYTES)
      const buf = Buffer.alloc(length)
      await handle.read(buf, 0, length, start)

      const text = buf.toString('utf-8')
      const lines = text.split('\n')

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim()
        if (!line) continue

        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }

        if (parsed.type !== 'assistant') continue

        const message = parsed.message as Record<string, unknown> | undefined
        if (!message?.usage) continue

        const usage = message.usage as {
          input_tokens?: number
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
        }

        const usedTokens =
          (usage.input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0)

        const model = (message.model as string) ?? (parsed.model as string) ?? 'unknown'

        let contextWindowSize = 200_000
        if (/1m|1M/.test(model) || usedTokens > 180_000) {
          contextWindowSize = 1_000_000
        }

        const percentage = Math.min(100, Math.round((usedTokens / contextWindowSize) * 100))

        return {
          usedTokens,
          contextWindowSize,
          percentage,
          model,
          sessionId,
          lastUpdated: newestMtime,
        }
      }

      return null
    } finally {
      await handle.close()
    }
  }
}
