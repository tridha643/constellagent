import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PiModelOption } from '../shared/plan-build-command'

const execFileAsync = promisify(execFile)
const PI_MODEL_TIMEOUT_MS = 10_000
const PI_MODEL_MAX_BUFFER = 1024 * 1024

function parsePiListModels(stdout: string): PiModelOption[] {
  const out: PiModelOption[] = []
  const seen = new Set<string>()

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('provider')) continue
    if (/^-{3,}/.test(line)) continue

    const match = line.match(/^(\S+)\s+(\S+)(?:\s+.+)?$/)
    if (!match) continue

    const provider = match[1]
    const model = match[2]
    const id = `${provider}/${model}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ provider, model, id })
  }

  return out
}

export async function listPiModels(): Promise<PiModelOption[]> {
  const { stdout } = await execFileAsync('pi', ['--list-models'], {
    timeout: PI_MODEL_TIMEOUT_MS,
    maxBuffer: PI_MODEL_MAX_BUFFER,
  })
  return parsePiListModels(stdout)
}
