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
console.log('2. In normal agent mode, verify planning-heavy prompts do not inject a plan-mode switch nudge or offer suggestPlanModeSwitch.')
console.log('3. Run pi /plan (or start with pi --plan) in a scratch repo and ask for a complex feature plan.')
console.log('4. Verify the model investigates first, then asks a strong initial askUserQuestion round before drafting the plan.')
console.log('5. Verify write/edit calls are blocked until a clarification round completes.')
console.log('6. Verify writes to README.md or src files are blocked in plan mode.')
console.log('7. Verify only ~/.pi-constell/plans/<slug>.md is editable after the clarification gate opens.')
console.log('8. Verify the saved plan uses ## Open Questions / Assumptions, ## Phases, and ## Recommendation.')
console.log('9. Verify ~/.pi-constell/plans is created automatically during install if it does not already exist.')
console.log('10. Verify a newly written ~/.pi-constell/plans file stays outside git status entirely.')
console.log('11. Verify saved filenames are action-oriented, specific, and collision-safe (slug, slug-2, ...).')
console.log('12. Verify askUserQuestion lets you pick preset option(s), add optional extra details, use spacebar multi-select toggles, and still supports My own thoughts.')
console.log('13. Verify the saved clarification context includes explicit option mappings like A/1 and B/2 so details such as "A then B" stay grounded.')
console.log('14. Verify read-only help commands remain usable while plan mode is active.')
console.log('15. Verify /plan-off and /agent both return the session to normal agent mode.')
console.log('16. Verify the saved plan includes every intended phase, not just Phase 1.')
console.log('17. Resume a session with plan mode enabled and verify plan-mode state (active plan path, clarification gate) restores as expected.')
console.log('18. Verify Constellagent can open the newest plan directly from ~/.pi-constell/plans via the Plans button or plan palette, rendering every phase while hiding YAML frontmatter in preview.')
console.log('19. Verify the saved plan covers the required constraints and validation details without becoming overly verbose or repetitive.')
