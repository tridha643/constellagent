import { spawn, type ChildProcess } from 'child_process'
import { getServerConfig, isServerAvailable } from './lsp-config'

interface ManagedServer {
  process: ChildProcess
  language: string
  workspace: string
  restartCount: number
  firstRestartTime: number
}

const MAX_RESTARTS = 3
const RESTART_WINDOW_MS = 5 * 60 * 1000

export class LspServerManager {
  private servers = new Map<string, ManagedServer>()
  private idleShutdownTimers = new Map<string, ReturnType<typeof setTimeout>>()

  private key(language: string, workspace: string): string {
    return `${language}:${workspace}`
  }

  getOrSpawn(language: string, workspace: string): ChildProcess | null {
    const k = this.key(language, workspace)
    this.clearIdleShutdown(k)
    const existing = this.servers.get(k)
    if (existing && !existing.process.killed) return existing.process

    return this.spawn(language, workspace)
  }

  scheduleRelease(language: string, workspace: string, idleMs = 60_000): void {
    const k = this.key(language, workspace)
    this.clearIdleShutdown(k)
    const managed = this.servers.get(k)
    if (!managed) return
    this.idleShutdownTimers.set(k, setTimeout(() => {
      const live = this.servers.get(k)
      if (!live) return
      live.restartCount = MAX_RESTARTS
      this.servers.delete(k)
      try {
        live.process.kill()
      } catch {
        // best effort
      }
      this.idleShutdownTimers.delete(k)
    }, idleMs))
  }

  private clearIdleShutdown(key: string): void {
    const timer = this.idleShutdownTimers.get(key)
    if (!timer) return
    clearTimeout(timer)
    this.idleShutdownTimers.delete(key)
  }

  private spawn(language: string, workspace: string): ChildProcess | null {
    const config = getServerConfig(language)
    if (!config || !isServerAvailable(config.command)) return null

    const k = this.key(language, workspace)
    this.clearIdleShutdown(k)
    const proc = spawn(config.command, config.args, {
      cwd: workspace,
      stdio: 'pipe',
      env: { ...process.env },
    })

    const managed: ManagedServer = {
      process: proc,
      language,
      workspace,
      restartCount: 0,
      firstRestartTime: 0,
    }

    proc.on('exit', (_code) => {
      this.servers.delete(k)
      this.maybeRestart(managed)
    })

    proc.on('error', () => {
      this.servers.delete(k)
    })

    this.servers.set(k, managed)
    return proc
  }

  private maybeRestart(managed: ManagedServer): void {
    const now = Date.now()
    if (now - managed.firstRestartTime > RESTART_WINDOW_MS) {
      managed.restartCount = 0
      managed.firstRestartTime = now
    }
    if (managed.restartCount >= MAX_RESTARTS) {
      console.warn(`[lsp] ${managed.language} server exceeded max restarts, not restarting`)
      return
    }
    managed.restartCount++
    if (managed.restartCount === 1) managed.firstRestartTime = now

    const delay = managed.restartCount * 1000
    setTimeout(() => {
      this.spawn(managed.language, managed.workspace)
    }, delay)
  }

  shutdown(): void {
    for (const [, timer] of this.idleShutdownTimers) {
      clearTimeout(timer)
    }
    this.idleShutdownTimers.clear()
    for (const [, managed] of this.servers) {
      managed.restartCount = MAX_RESTARTS // prevent restart on kill
      try { managed.process.kill() } catch {}
    }
    this.servers.clear()
  }
}
