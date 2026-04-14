import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import type { BackgroundProcess } from './types.js'

interface RunningProcess extends BackgroundProcess {
  child: ChildProcess
  waiters: Array<(result: BackgroundProcess) => void>
}

export class ProcessTracker {
  private readonly processes = new Map<string, RunningProcess>()

  list(): BackgroundProcess[] {
    return [...this.processes.values()].map(({ child: _child, waiters: _waiters, ...process }) => ({ ...process }))
  }

  get(taskId: string): BackgroundProcess | undefined {
    const process = this.processes.get(taskId)
    if (!process) return undefined
    const { child: _child, waiters: _waiters, ...rest } = process
    return { ...rest }
  }

  async start(taskId: string, command: string, opts: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<BackgroundProcess> {
    const existing = this.processes.get(taskId)
    if (existing && existing.status === 'running') return this.get(taskId)!

    const child = spawn(command, {
      cwd: opts.cwd,
      env: opts.env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const running: RunningProcess = {
      taskId,
      pid: child.pid ?? -1,
      command,
      output: [],
      status: 'running',
      startedAt: Date.now(),
      child,
      waiters: [],
    }
    this.processes.set(taskId, running)

    const push = (chunk: Buffer | string) => {
      running.output.push(String(chunk))
    }
    child.stdout?.on('data', push)
    child.stderr?.on('data', push)
    child.on('error', (error) => {
      this.finish(taskId, {
        status: 'error',
        exitCode: null,
        lastError: error.message,
      })
    })
    child.on('close', (code) => {
      this.finish(taskId, {
        status: running.status === 'stopped' ? 'stopped' : code === 0 ? 'completed' : 'error',
        exitCode: code,
      })
    })

    return this.get(taskId)!
  }

  async waitForCompletion(taskId: string, timeoutMs: number): Promise<BackgroundProcess | null> {
    const existing = this.processes.get(taskId)
    if (!existing) return null
    if (existing.status !== 'running') return this.get(taskId)!

    return Promise.race([
      new Promise<BackgroundProcess>((resolvePromise) => {
        existing.waiters.push(resolvePromise)
      }),
      delay(timeoutMs).then(() => null),
    ])
  }

  async stop(taskId: string): Promise<BackgroundProcess | null> {
    const running = this.processes.get(taskId)
    if (!running) return null
    if (running.status !== 'running') return this.get(taskId)!

    running.status = 'stopped'
    running.child.kill('SIGTERM')
    const settled = await this.waitForCompletion(taskId, 5000)
    if (settled) return settled
    running.child.kill('SIGKILL')
    return this.waitForCompletion(taskId, 1000)
  }

  consumeOutput(taskId: string): string[] {
    const running = this.processes.get(taskId)
    if (!running) return []
    const chunks = [...running.output]
    running.output.length = 0
    return chunks
  }

  private finish(taskId: string, patch: { status: BackgroundProcess['status']; exitCode?: number | null; lastError?: string }): void {
    const running = this.processes.get(taskId)
    if (!running) return
    running.status = patch.status
    running.completedAt = Date.now()
    running.exitCode = patch.exitCode
    running.lastError = patch.lastError
    const snapshot = this.get(taskId)!
    const waiters = [...running.waiters]
    running.waiters.length = 0
    for (const waiter of waiters) waiter(snapshot)
  }
}
