import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { allocatePlanPath, buildPlanMarkdown, derivePlanTitle, isSafeCommand, savePlanFile, slugifyPlanTitle } from '../extensions/utils.js'

test('isSafeCommand blocks destructive shell commands', () => {
  assert.equal(isSafeCommand('ls -la'), true)
  assert.equal(isSafeCommand('git status'), true)
  assert.equal(isSafeCommand('rm -rf src'), false)
  assert.equal(isSafeCommand('npm publish'), false)
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
  assert.match(title, /Ask/i)
})

test('slugifyPlanTitle produces a concise cursor-like slug', () => {
  assert.equal(slugifyPlanTitle('Improve plan mode questionnaire UX'), 'improve-plan-mode-questionnaire-ux')
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
  assert.match(result!.markdown, /^# Publish Pi Constell Plan Npm/m)
})

test('allocatePlanPath uses numeric suffixes instead of timestamps', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-constell-plan-'))
  const first = await allocatePlanPath(cwd, 'Improve plan mode questionnaire UX')
  assert.match(first, /improve-plan-mode-questionnaire-ux\.md$/)
  await savePlanFile(cwd, `# Improve plan mode questionnaire UX

## Plan
1. Add tests
2. Publish`, null, {}, first)
  const second = await allocatePlanPath(cwd, 'Improve plan mode questionnaire UX', null)
  assert.match(second, /improve-plan-mode-questionnaire-ux-2\.md$/)
})

test('savePlanFile writes frontmatter and renames when a better title appears', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-constell-save-'))
  const initial = await allocatePlanPath(cwd, 'Implementation Plan')
  const saved = await savePlanFile(cwd, `# Improve plan mode questionnaire UX

## Plan
1. Add tests
2. Publish`, 'anthropic/sonnet', {
    prompt: 'improve the plan mode questionnaire ux',
  }, initial)

  assert.ok(saved)
  assert.match(saved!.path, /improve-plan-mode-questionnaire-ux\.md$/)
  const content = await readFile(saved!.path, 'utf-8')
  assert.match(content, /buildHarness: "pi-constell-plan"/)
  assert.match(content, /# Improve plan mode questionnaire UX/)
})
