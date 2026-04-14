import { readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { allocatePlanPath, buildPlanMarkdown, derivePlanTitle, getPlanDir, isSafeCommand, savePlanFile, slugifyPlanTitle } from '../extensions/utils.js'

async function removeIfExists(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => {})
}

test('isSafeCommand blocks destructive shell commands', () => {
  assert.equal(isSafeCommand('ls -la'), true)
  assert.equal(isSafeCommand('git status'), true)
  assert.equal(isSafeCommand('pi -h'), true)
  assert.equal(isSafeCommand('rm -rf src'), false)
  assert.equal(isSafeCommand('npm publish'), false)
  assert.equal(isSafeCommand('pi /plan'), false)
})

test('derivePlanTitle prefers a specific heading', () => {
  const title = derivePlanTitle(`# Improve plan mode questionnaire UX

## Plan
1. Add a tool`, {
    prompt: 'please help me improve the plan mode questionnaire',
  })
  assert.equal(title, 'Improve plan mode questionnaire UX')
})

test('derivePlanTitle falls back to prompt context when heading is generic', () => {
  const title = derivePlanTitle(`# Plan

## Plan
1. Add askUserQuestion support`, {
    prompt: 'I want to improve the pi constell plan mode extension ask user question flow',
  })
  assert.match(title, /Improve/i)
  assert.match(title, /Flow/i)
})

test('slugifyPlanTitle produces a concise cursor-like slug', () => {
  assert.equal(slugifyPlanTitle('Improve plan mode questionnaire UX'), 'improve-plan-mode-questionnaire-ux')
})

test('derivePlanTitle keeps only the strongest action clauses from noisy prompts', () => {
  const title = derivePlanTitle(`# Plan

## Goal
- Do the work`, {
    prompt: 'for pi-constell-plan extension I as the user want the ability to toggle multiple options via spacebar, and have a field to add extra details. remove the image integration part.',
  })
  assert.match(title, /^Toggle Multiple Options/)
  assert.match(title, /Add/)
})

test('buildPlanMarkdown injects a derived title when missing', () => {
  const result = buildPlanMarkdown(`## Goal
Ship faster

## Plan
1. Add tests
2. Publish package`, {
    prompt: 'publish pi constell plan to npm',
  })
  assert.ok(result)
  assert.match(result!.markdown, /^# Publish Plan Npm/m)
})

test('buildPlanMarkdown accepts phase-based plan output', () => {
  const result = buildPlanMarkdown(`## Open Questions / Assumptions
- None.

## Phases

### Phase 1
Goal: Ship faster.

Why this phase boundary makes sense: Keep the change focused.

Main code areas:
- extension

Task breakdown:
- Add tests.

Tests:
- Run verify.

How I'll validate:
- Check the saved plan.

## Recommendation
- Start with Phase 1.`, {
    prompt: 'improve the plan mode questionnaire ux',
  })
  assert.ok(result)
  assert.match(result!.markdown, /^# Improve Plan Mode Questionnaire Ux/m)
})

test('getPlanDir stores plans under the user home directory', () => {
  assert.equal(getPlanDir(), join(homedir(), '.pi-constell', 'plans'))
})

test('allocatePlanPath uses numeric suffixes instead of timestamps', async () => {
  const cwd = '/tmp/ignored-pi-constell-cwd'
  const title = `Improve plan mode questionnaire UX ${Date.now()}`
  const first = await allocatePlanPath(cwd, title)
  try {
    assert.equal(first.startsWith(join(homedir(), '.pi-constell', 'plans')), true)
    assert.match(first, /improve-plan-mode-questionnaire-ux-\d+\.md$/)
    await savePlanFile(cwd, `# ${title}

## Plan
1. Add tests
2. Publish`, null, {}, first)
    const second = await allocatePlanPath(cwd, title, null)
    assert.match(second, /improve-plan-mode-questionnaire-ux-\d+-2\.md$/)
  } finally {
    await removeIfExists(first)
  }
})

test('savePlanFile writes frontmatter and renames when a better title appears', async () => {
  const cwd = '/tmp/ignored-pi-constell-cwd'
  const initial = await allocatePlanPath(cwd, `Working Plan ${Date.now()}`)
  const saved = await savePlanFile(cwd, `# Improve plan mode questionnaire UX

## Open Questions / Assumptions
- None.

## Phases

### Phase 1
Goal: Add tests.

Why this phase boundary makes sense: It keeps the rollout simple.

Main code areas:
- extensions

Task breakdown:
- Add tests.

Tests:
- Run verify.

How I'll validate:
- Confirm the file saves.

## Recommendation
- Start with Phase 1.`, 'anthropic/sonnet', {
    prompt: 'improve the plan mode questionnaire ux',
  }, initial)

  try {
    assert.ok(saved)
    assert.match(saved!.path, /improve-plan-mode-questionnaire-ux(?:-\d+)?\.md$/)
    const content = await readFile(saved!.path, 'utf-8')
    assert.match(content, /buildHarness: "pi-constell-plan"/)
    assert.match(content, /# Improve plan mode questionnaire UX/)
  } finally {
    await removeIfExists(initial)
    if (saved?.path) await removeIfExists(saved.path)
  }
})
