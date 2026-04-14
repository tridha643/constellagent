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
console.log('3. Verify the model investigates first and then asks an initial 3-4 question askUserQuestion batch before drafting the plan.')
console.log('4. Verify write/edit calls are blocked until a clarification round completes.')
console.log('5. Verify writes to README.md or src files are blocked in plan mode.')
console.log('6. Verify only ~/.pi-constell/plans/<slug>.md is editable after the clarification gate opens.')
console.log('7. Verify the saved plan includes phase-based sections, task breakdowns, and explicit validation headings.')
console.log('8. Verify ~/.pi-constell/plans is created automatically during install if it does not already exist.')
console.log('9. Verify a newly written ~/.pi-constell/plans file stays outside git status entirely.')
console.log('10. Verify saved filenames are action-oriented, specific, and collision-safe (slug, slug-2, ...).')
console.log('11. Verify askUserQuestion lets you pick preset option(s), add optional extra details, use spacebar multi-select toggles, and still supports My own thoughts.')
console.log('12. Verify saving a plan writes ~/.pi/<workspaceId>/tasks/handoff.json with the saved plan reference.')
console.log('13. Verify the first saved plan also seeds ~/.pi/<workspaceId>/tasks/tasks.json from phase headings when the shared task graph is empty.')
console.log('14. Verify the handoff files are not written outside ~/.pi/<workspaceId>/tasks/.')
console.log('15. Verify pi -h still exposes --plan and the extension help path while the extension is loaded.')
console.log('16. Verify /plan-off or /agent exits plan mode explicitly and restores normal agent behavior.')
