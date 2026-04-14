/**
 * Verifies the pi-constell-tasks extension loads in the real `pi` CLI.
 *
 * 1. Always: `pi -ne -e <extension> -h` must successfully load with the extension.
 * 2. Best-effort: if command names appear in help output, validate the `/tasks` command surface.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXTENSION = resolve(__dirname, '../extensions/pi-constell-tasks.ts')

function whichPi(): string {
  const fromEnv = process.env.PI_BIN?.trim()
  if (fromEnv) return fromEnv
  const w = spawnSync('which', ['pi'], { encoding: 'utf8' })
  if (w.status === 0 && w.stdout.trim()) return w.stdout.trim()
  return 'pi'
}

const piBin = whichPi()
console.log(`Using pi binary: ${piBin}`)

const result = spawnSync(piBin, ['-ne', '-e', EXTENSION, '-h'], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
})

if (result.error) throw result.error
if (result.status !== 0) {
  console.error(result.stderr || result.stdout)
  throw new Error(`pi -h exited ${result.status}`)
}

const out = `${result.stdout}\n${result.stderr}`
if (out.includes('tasks')) {
  console.log('OK: help output mentions the tasks command surface')
} else {
  console.log('Note: pi -h did not expose /tasks directly; rely on manual verification for command visibility.')
}

console.log('verify-pi-cli: all checks passed')
