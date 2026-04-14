/**
 * Verifies the pi-constell extension loads in the real `pi` CLI.
 *
 * 1. Always: `pi -ne -e <extension> -h` must list the `--plan` flag (proves the extension executed).
 * 2. Best-effort: if command names appear in help output, validate the explicit plan command surface too.
 * 3. Optional: VERIFY_PI_PRINT=1 runs a short `pi -p` prompt (needs working API auth; may skip if no credentials).
 */
import { spawnSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXTENSION = resolve(__dirname, '../extensions/pi-constell.ts')

function whichPi(): string {
  const fromEnv = process.env.PI_BIN?.trim()
  if (fromEnv) return fromEnv
  const w = spawnSync('which', ['pi'], { encoding: 'utf8' })
  if (w.status === 0 && w.stdout.trim()) return w.stdout.trim()
  return 'pi'
}

function assertExtensionHelp(piBin: string): void {
  const r = spawnSync(piBin, ['-ne', '-e', EXTENSION, '-h'], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  if (r.error) throw r.error
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout)
    throw new Error(`pi -h exited ${r.status}`)
  }
  const out = `${r.stdout}\n${r.stderr}`
  if (!out.includes('--plan')) {
    throw new Error('Expected `pi -h` to list --plan when loading pi-constell (extension did not register)')
  }
  if (!out.includes('pi-constell-plan')) {
    throw new Error('Expected help text to mention pi-constell-plan mode')
  }
  const knownCommands = ['plan-off', 'agent']
  const visibleCommands = knownCommands.filter((name) => out.includes(name))
  if (visibleCommands.length > 0) {
    console.log(`OK: help exposes command surface (${visibleCommands.join(', ')})`)
  } else {
    console.log('Note: pi -h did not expose plan command names directly; rely on manual verification for command visibility.')
  }
  console.log('OK: pi loads extension (help lists --plan / pi-constell-plan)')
}

function hasLikelyAuth(): boolean {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return true
  if (process.env.OPENAI_API_KEY?.trim()) return true
  if (process.env.GEMINI_API_KEY?.trim()) return true
  const authJson = join(homedir(), '.pi/agent/auth.json')
  return existsSync(authJson)
}

async function optionalPrintMode(piBin: string): Promise<void> {
  if (process.env.VERIFY_PI_PRINT !== '1') {
    console.log('Skip: set VERIFY_PI_PRINT=1 to run a non-interactive `pi -p` smoke test')
    return
  }
  if (!hasLikelyAuth()) {
    console.log('Skip VERIFY_PI_PRINT: no ANTHROPIC/OPENAI/GEMINI key and no ~/.pi/agent/auth.json')
    return
  }

  const model = process.env.PI_VERIFY_MODEL ?? 'anthropic/claude-haiku-4-5-20251001'
  const prompt = process.env.PI_VERIFY_PROMPT ?? 'Reply with exactly the digit 4 and nothing else. What is 2+2?'

  console.log(`Running: pi -p (model ${model}) …`)
  const child = spawn(
    piBin,
    [
      '-ne',
      '-e',
      EXTENSION,
      '--no-session',
      '--no-tools',
      '--model',
      model,
      '-p',
      prompt,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  const timeoutMs = Number(process.env.PI_VERIFY_TIMEOUT_MS ?? '120000')
  const killTimer = setTimeout(() => {
    child.kill('SIGTERM')
  }, timeoutMs)

  const stdout = await new Promise<string>((res, rej) => {
    let buf = ''
    child.stdout?.on('data', (c: Buffer) => {
      buf += c.toString()
    })
    child.stderr?.on('data', (c: Buffer) => {
      process.stderr.write(c)
    })
    child.on('error', rej)
    child.on('close', (code) => {
      clearTimeout(killTimer)
      if (code === 0) res(buf)
      else rej(new Error(`pi -p exited ${code}`))
    })
  })

  if (!stdout.includes('4')) {
    console.error('--- pi -p stdout ---\n', stdout.slice(-2000))
    throw new Error('Expected pi -p output to contain "4" for the 2+2 smoke prompt')
  }
  console.log('OK: non-interactive pi -p returned a response containing "4"')
}

const piBin = whichPi()
console.log(`Using pi binary: ${piBin}`)
assertExtensionHelp(piBin)
await optionalPrintMode(piBin)
console.log('verify-pi-cli: all checks passed')
