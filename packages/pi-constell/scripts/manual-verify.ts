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
console.log('2. In a scratch repo, give pi a planning-heavy request while still in normal mode.')
console.log('3. Verify the model asks for consent with suggestPlanModeSwitch instead of auto-switching or editing immediately.')
console.log('4. Verify the consent UI shows Accept vs Stay, includes a visible 15 second countdown, and defaults to staying in agent mode on timeout.')
console.log('5. Accept the switch and verify the footer/tools flip into plan mode immediately for the same prompt.')
console.log('6. After acceptance, verify askUserQuestion is still required before write/edit is allowed.')
console.log('7. Decline the switch and verify the session stays in normal mode and the model does not ask again during that same prompt.')
console.log('8. Let the switch prompt time out and verify the result matches the decline behavior for the current prompt only.')
console.log('9. Send a new planning-heavy prompt after a decline/timeout and verify plan mode can be suggested again.')
console.log('10. Run pi /plan in the same scratch repo and ask for a complex feature plan.')
console.log('11. Verify the model investigates first, then asks a strong initial askUserQuestion round before drafting the plan.')
console.log('12. Verify write/edit calls are blocked until a clarification round completes.')
console.log('13. Verify writes to README.md or src files are blocked in plan mode.')
console.log('14. Verify only ~/.pi-constell/plans/<slug>.md is editable after the clarification gate opens.')
console.log('15. Verify the saved plan uses ## Open Questions / Assumptions, ## Phases, and ## Recommendation.')
console.log('16. Verify ~/.pi-constell/plans is created automatically during install if it does not already exist.')
console.log('17. Verify a newly written ~/.pi-constell/plans file stays outside git status entirely.')
console.log('18. Verify saved filenames are action-oriented, specific, and collision-safe (slug, slug-2, ...).')
console.log('19. Verify askUserQuestion lets you pick preset option(s), add optional extra details, use spacebar multi-select toggles, and still supports My own thoughts.')
console.log('20. Verify the saved clarification context includes explicit option mappings like A/1 and B/2 so details such as "A then B" stay grounded.')
console.log('21. Verify read-only help commands remain usable while plan mode is active.')
console.log('22. Verify /plan-off and /agent both return the session to normal agent mode.')
console.log('23. Verify the saved plan includes every intended phase, not just Phase 1.')
console.log('24. Resume a session after an accepted switch and verify only real plan-mode state persists; decline/timeout suppression should not leak into later prompts.')
console.log('25. Verify Constellagent can open the newest plan directly from ~/.pi-constell/plans via the Plans button or plan palette, rendering every phase while hiding YAML frontmatter in preview.')
console.log('26. Verify the saved plan covers the required constraints and validation details without becoming overly verbose or repetitive.')
