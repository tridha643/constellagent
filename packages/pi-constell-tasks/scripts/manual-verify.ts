import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const cwd = resolve(process.cwd())
const tempWorkspace = await mkdtemp(join(tmpdir(), 'pi-constell-tasks-manual-'))

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
console.log('1. Install globally from npm after publish: pi install npm:pi-constell-tasks')
console.log('2. In a workspace where pi-constell-plan already saved a plan, start a separate pi instance with this extension enabled.')
console.log('3. Verify the startup context includes the stored plan reference and current task summary.')
console.log('4. Verify /tasks opens the manual TUI task surface and can create, view, clear, and configure workspace tasks.')
console.log('5. Verify TaskCreate/TaskList/TaskGet/TaskUpdate/TaskOutput/TaskStop/TaskExecute work without plan mode.')
console.log('6. Verify auto-cascade starts newly unblocked dependent tasks only when enabled.')
console.log('7. Verify auto-clear modes behave deterministically.')
console.log('8. Verify file-backed workspace scope survives a second pi instance or process restart.')
console.log('9. Verify session and memory scopes are documented and behave as non-handoff modes.')
console.log('10. Verify stale or missing stored plan paths degrade gracefully instead of crashing startup.')
