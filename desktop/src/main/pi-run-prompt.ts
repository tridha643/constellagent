import { homedir } from 'os'
import * as pty from 'node-pty'

import { pickPiModelIdForCli } from '../shared/pi-models'
import { listPiModels } from './pi-models'

const PI_GENERATE_TIMEOUT_MS = 30_000
const PI_GENERATE_MAX_BUFFER = 1024 * 1024
const PI_OUTPUT_IDLE_MS = 750

export const PI_DEFAULT_MODEL = 'composer-2-fast'

function stripTerminalNoise(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
    .replace(/\r/g, '')
}

export interface RunPiPromptOptions {
  /** Defaults to `composer-2-fast` (same as commit messages). */
  model?: string
}

/**
 * Run the `pi` CLI in print mode with no tools/skills — shared by commit messages and Linear drafts.
 */
async function resolvePiCliModel(preferred: string): Promise<string> {
  try {
    const models = await listPiModels()
    return pickPiModelIdForCli(models, preferred)
  } catch {
    return preferred
  }
}

export async function runPiPrompt(
  prompt: string,
  options?: RunPiPromptOptions,
): Promise<string> {
  const preferred = options?.model ?? PI_DEFAULT_MODEL
  const model = await resolvePiCliModel(preferred)
  return await new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    let sawMeaningfulOutput = false
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    const proc = pty.spawn(
      'pi',
      [
        '--mode',
        'text',
        '--print',
        '--no-session',
        '--no-tools',
        '--no-skills',
        '--no-prompt-templates',
        '--no-themes',
        '--thinking',
        'off',
        // Override ~/.pi enabled model patterns; otherwise stale patterns (e.g. claude-3-7-sonnet-latest)
        // are validated at startup and emit warnings before `--model` is applied.
        '--models',
        model,
        '--model',
        model,
        prompt,
      ],
      {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: homedir(),
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        } as Record<string, string>,
      },
    )

    const clearIdleTimer = (): void => {
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }

    const finalize = (result: { ok: true; value: string } | { ok: false; error: Error }): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      clearIdleTimer()
      try {
        proc.kill()
      } catch {
        // ignore kill failures after process exit
      }
      if (result.ok) resolve(result.value)
      else reject(result.error)
    }

    const scheduleIdleFinish = (): void => {
      if (!sawMeaningfulOutput) return
      clearIdleTimer()
      idleTimer = setTimeout(() => {
        finalize({ ok: true, value: output })
      }, PI_OUTPUT_IDLE_MS)
    }

    const timeoutTimer = setTimeout(() => {
      finalize({ ok: false, error: new Error('Pi generation timed out.') })
    }, PI_GENERATE_TIMEOUT_MS)

    proc.onData((chunk) => {
      output += chunk
      if (stripTerminalNoise(chunk).trim()) {
        sawMeaningfulOutput = true
      }
      if (output.length > PI_GENERATE_MAX_BUFFER) {
        finalize({ ok: false, error: new Error('Pi produced too much output.') })
        return
      }
      scheduleIdleFinish()
    })

    proc.onExit(({ exitCode }) => {
      if (settled) return
      const cleaned = stripTerminalNoise(output).trim()
      if (cleaned) {
        finalize({ ok: true, value: output })
        return
      }
      if (exitCode === 0) {
        finalize({ ok: false, error: new Error('Pi did not return output.') })
        return
      }
      finalize({ ok: false, error: new Error('Pi exited with an error.') })
    })
  })
}
