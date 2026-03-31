import { readdirSync, statSync, realpathSync, readSync, openSync, closeSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { ContextWindowData } from '../shared/context-window-types'

const TAIL_BYTES = 64 * 1024

export class ContextWindowService {
  async getUsage(worktreePath: string): Promise<ContextWindowData | null> {
    try {
      const resolved = realpathSync(worktreePath)
      const encoded = resolved.replace(/\//g, '-')
      const projectDir = join(homedir(), '.claude', 'projects', encoded)

      let files: string[]
      try {
        files = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'))
      } catch {
        return null
      }
      if (files.length === 0) return null

      // Pick newest by mtime
      let newest = ''
      let newestMtime = 0
      for (const f of files) {
        const full = join(projectDir, f)
        try {
          const st = statSync(full)
          if (st.mtimeMs > newestMtime) {
            newestMtime = st.mtimeMs
            newest = full
          }
        } catch {
          continue
        }
      }
      if (!newest) return null

      const sessionId = newest.replace(/.*\//, '').replace('.jsonl', '')

      // Tail-read last ~64KB
      const fd = openSync(newest, 'r')
      try {
        const st = statSync(newest)
        const size = st.size
        const start = Math.max(0, size - TAIL_BYTES)
        const buf = Buffer.alloc(Math.min(size, TAIL_BYTES))
        readSync(fd, buf, 0, buf.length, start)

        const text = buf.toString('utf-8')
        const lines = text.split('\n')

        // Iterate backwards to find last assistant message with usage
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

          // Determine context window size from model
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
        closeSync(fd)
      }
    } catch {
      return null
    }
  }
}
