import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const cwd = resolve(process.cwd())
const tempWorkspace = await mkdtemp(join(tmpdir(), 'pi-constell-manual-'))

const steps: Array<[string, string[]]> = [
  ['npm', ['run', 'verify']],
  ['npm', ['pack', '--dry-run']],
]

for (const [command, args] of steps) {
  console.log(`\n$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log('\nManual verification workspace:', tempWorkspace)
console.log('\nInteractive checklist:')
console.log('1. Install globally from npm after publish: pi install npm:pi-constell-plan')
console.log('2. Run pi /plan in a scratch repo and ask for a complex feature plan.')
console.log('3. Verify askUserQuestion opens a tabbed questionnaire and supports My own thoughts.')
console.log('4. Verify writes to README.md or src files are blocked in plan mode.')
console.log('5. Verify only .pi-constell/plans/<slug>.md is editable.')
console.log('6. Verify saved filenames are action-oriented and collision-safe (slug, slug-2, ...).')
