/**
 * Real CLI chain: `pi -p` in plan mode (headless clarification) → handoff on disk →
 * second `pi -p` with pi-constell-tasks to consume TaskList + context.
 *
 * Requires: API credentials (same as normal `pi`), repo root `bun install`.
 *
 * Env:
 *   AGENT_ORCH_WS_ID — optional; defaults to a unique e2e id
 *   PI_BIN — pi executable (default: local node_modules/.bin/pi or PATH)
 *   PI_VERIFY_MODEL — model (default: anthropic/claude-haiku-4-5-20251001)
 *   PI_CONSTELL_HEADLESS_CLARIFICATION=1 — set automatically by this script for session 1
 *   PI_E2E_TIMEOUT_MS — spawn timeout per session (default: 240000)
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getWorkspaceTaskManifestPath,
  getWorkspaceTaskRoot,
  removeWorkspaceTaskRoot,
} from '../extensions/task-handoff.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(__dirname, '..')
const tasksExtension = resolve(packageRoot, '../pi-constell-tasks/extensions/pi-constell-tasks.ts')
const planExtension = resolve(packageRoot, 'extensions/pi-constell.ts')

const workspaceId =
  process.env.AGENT_ORCH_WS_ID?.trim() || `pi-e2e-handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const model = process.env.PI_VERIFY_MODEL ?? 'anthropic/claude-haiku-4-5-20251001'
const timeoutMs = Number(process.env.PI_E2E_TIMEOUT_MS ?? '240000')

function resolvePiBin(): string {
  const fromEnv = process.env.PI_BIN?.trim()
  if (fromEnv) return fromEnv
  const local = join(packageRoot, 'node_modules/.bin/pi')
  if (existsSync(local)) return local
  return 'pi'
}

const piBin = resolvePiBin()

const planPrompt = `You are running an automated end-to-end check. This directory is disposable.

1) Call askUserQuestion exactly once with exactly 3 questions. Each question must have exactly 2 options. Keep questions trivial.
2) Your final assistant message must be ONLY markdown (no code fences, no preamble) with exactly this structure:

## Open Questions / Assumptions
Smoke test assumptions only.

## Phases

### Phase 1
- Goal: Implement hello.ts that exports hello()

### Phase 2
- Goal: Add a one-line note to README

## Recommendation
Complete Phase 1 before Phase 2.

Use "### Phase 1" and "### Phase 2" headings exactly.`

const tasksPrompt = `Workspace task handoff should be in your context.
You MUST call the TaskList tool exactly once (use default arguments).
Then output exactly one line:
E2E_HANDOFF_SUBJECTS: <comma-separated task subjects from TaskList>
No other text after that line.`

async function main(): Promise<void> {
  if (!existsSync(tasksExtension)) {
    console.error('Missing pi-constell-tasks extension at', tasksExtension)
    process.exit(1)
  }

  const scratch = join(tmpdir(), `pi-handoff-e2e-${Date.now()}`)
  await mkdir(scratch, { recursive: true })
  await writeFile(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'pi-handoff-e2e', private: true, version: '0.0.0' }, null, 2),
    'utf-8',
  )

  await removeWorkspaceTaskRoot(workspaceId).catch(() => {})

  const baseEnv = {
    ...process.env,
    AGENT_ORCH_WS_ID: workspaceId,
    PI_CONSTELL_HEADLESS_CLARIFICATION: '1',
  } as NodeJS.ProcessEnv

  console.log('Session 1: plan mode + headless clarification')
  console.log('  cwd:', scratch)
  console.log('  workspace:', workspaceId)
  console.log('  pi:', piBin)

  const s1 = spawnSync(
    piBin,
    ['-ne', '-e', planExtension, '--plan', '--no-session', '--model', model, '-p', planPrompt],
    {
      cwd: scratch,
      env: baseEnv,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      timeout: timeoutMs,
    },
  )

  if (s1.error) throw s1.error
  if (s1.status !== 0) {
    console.error(s1.stdout || '')
    console.error(s1.stderr || '')
    process.exit(s1.status ?? 1)
  }

  const manifestPath = getWorkspaceTaskManifestPath(workspaceId)
  const taskRoot = getWorkspaceTaskRoot(workspaceId)
  const tasksPath = join(taskRoot, 'tasks.json')

  if (!existsSync(manifestPath)) {
    console.error('Expected handoff manifest at', manifestPath)
    process.exit(1)
  }
  if (!existsSync(tasksPath)) {
    console.error('Expected tasks.json at', tasksPath)
    process.exit(1)
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as { plan?: { path?: string }; seed?: { taskCount?: number } }
  const tasksDoc = JSON.parse(await readFile(tasksPath, 'utf-8')) as { tasks?: unknown[] }
  const taskCount = tasksDoc.tasks?.length ?? 0

  if (!manifest.plan?.path || !existsSync(manifest.plan.path)) {
    console.error('Manifest plan.path missing or not on disk:', manifest.plan?.path)
    process.exit(1)
  }
  if (taskCount < 2) {
    console.error('Expected at least 2 seeded tasks, got', taskCount)
    process.exit(1)
  }

  console.log('OK: handoff manifest +', taskCount, 'seeded tasks')
  console.log('  plan:', manifest.plan.path)

  const baseEnv2 = { ...process.env, AGENT_ORCH_WS_ID: workspaceId } as NodeJS.ProcessEnv
  delete baseEnv2.PI_CONSTELL_HEADLESS_CLARIFICATION

  console.log('\nSession 2: tasks extension (non-interactive)')

  const s2 = spawnSync(
    piBin,
    ['-ne', '-e', tasksExtension, '--no-session', '--model', model, '-p', tasksPrompt],
    {
      cwd: scratch,
      env: baseEnv2,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      timeout: timeoutMs,
    },
  )

  if (s2.error) throw s2.error
  if (s2.status !== 0) {
    console.error(s2.stdout || '')
    console.error(s2.stderr || '')
    process.exit(s2.status ?? 1)
  }

  const out = `${s2.stdout}\n${s2.stderr}`
  const match = out.match(/E2E_HANDOFF_SUBJECTS:\s*(.+)/)
  if (!match) {
    console.error('Session 2 output did not include E2E_HANDOFF_SUBJECTS line.\n---\n', out.slice(-4000))
    process.exit(1)
  }

  const listed = match[1]!.split(',').map((s) => s.trim()).filter(Boolean)
  if (listed.length < 2) {
    console.error('Expected multiple subjects in E2E_HANDOFF_SUBJECTS, got:', match[1])
    process.exit(1)
  }

  console.log('OK: session 2 TaskList + marker:', match[0].trim())
  console.log('\nE2E plan → handoff → tasks (pi -p) completed successfully.')

  await removeWorkspaceTaskRoot(workspaceId).catch(() => {})
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
