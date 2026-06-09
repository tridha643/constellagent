import { describe, expect, it } from 'bun:test'
import {
  PLAN_MODEL_PRESETS,
  buildAdHocAgentCommand,
  buildPlanAgentCommand,
  canonicalPlanModelValue,
  isModelLabelFromOtherHarness,
} from './plan-build-command'
import type { PlanAgent } from './agent-plan-path'

describe('plan build model/provider regression matrix', () => {
  it('builds commands for every harness with provider-specific models, not just one provider', () => {
    const cases: Array<{
      agent: PlanAgent
      model: string
      expected: string
    }> = [
      { agent: 'claude-code', model: 'Claude Sonnet 4.6', expected: "claude --model claude-sonnet-4-6 'Implement the plan in .claude/plans/ship.md'" },
      { agent: 'codex', model: 'GPT-5.3 Codex', expected: "codex --model gpt-5.3-codex 'Implement the plan in .claude/plans/ship.md'" },
      { agent: 'gemini', model: 'Gemini 2.5 Pro', expected: "gemini --model gemini-2.5-pro 'Implement the plan in .claude/plans/ship.md'" },
      { agent: 'cursor', model: 'Sonnet 4.6 1M (current)', expected: "cursor-agent --model claude-4.6-sonnet-medium 'Implement the plan in .claude/plans/ship.md'" },
      { agent: 'opencode', model: 'Claude Opus 4.6', expected: "opencode --model claude-opus-4-6 'Implement the plan in .claude/plans/ship.md'" },
      { agent: 'pi-constell', model: 'openai/gpt-5.1', expected: "pi --model openai/gpt-5.1 'Implement the plan in .claude/plans/ship.md'" },
    ]

    for (const { agent, model, expected } of cases) {
      const { command } = buildPlanAgentCommand(agent, '/repo', '/repo/.claude/plans/ship.md', model)
      expect(command).toBe(expected)
    }
  })

  it('detects stale model labels when switching between harness providers', () => {
    expect(isModelLabelFromOtherHarness('claude-code', 'Gemini 2.5 Pro')).toBe(true)
    expect(isModelLabelFromOtherHarness('gemini', 'Composer 2')).toBe(true)
    expect(isModelLabelFromOtherHarness('codex', 'claude-4.6-sonnet-medium')).toBe(true)
    expect(isModelLabelFromOtherHarness('cursor', 'gpt-5.3-codex')).toBe(false)
    expect(isModelLabelFromOtherHarness('gemini', 'gemini-2.5-pro')).toBe(false)
    expect(isModelLabelFromOtherHarness('opencode', 'my-local-custom-model')).toBe(false)
  })

  it('keeps Cursor regression coverage across multiple upstream model families', () => {
    const cursorModels = PLAN_MODEL_PRESETS.cursor.map((preset) => preset.cliModel)
    expect(cursorModels.some((model) => model.startsWith('gpt-'))).toBe(true)
    expect(cursorModels.some((model) => model.startsWith('claude-'))).toBe(true)
    expect(cursorModels.some((model) => model.startsWith('gemini-'))).toBe(true)
    expect(cursorModels.some((model) => model.startsWith('grok-'))).toBe(true)
    expect(cursorModels.some((model) => model.startsWith('kimi-'))).toBe(true)
  })

  it('canonicalizes model labels independently per selected harness', () => {
    expect(canonicalPlanModelValue('claude-code', 'Claude Sonnet 4.6')).toBe('claude-sonnet-4-6')
    expect(canonicalPlanModelValue('codex', 'GPT-5.3 Codex')).toBe('gpt-5.3-codex')
    expect(canonicalPlanModelValue('gemini', 'Gemini 2.5 Pro')).toBe('gemini-2.5-pro')
    expect(canonicalPlanModelValue('cursor', 'Sonnet 4.6 1M (current)')).toBe('claude-4.6-sonnet-medium')
    expect(canonicalPlanModelValue('opencode', 'Claude Opus 4.6')).toBe('claude-opus-4-6')
    expect(canonicalPlanModelValue('pi-constell', 'anthropic/claude-sonnet-4.6')).toBe('anthropic/claude-sonnet-4.6')
  })
})

describe('buildAdHocAgentCommand autoApprove', () => {
  it('omits the bypass flag for UI launches (default)', () => {
    const { command } = buildAdHocAgentCommand('claude-code', null, 'hi')
    expect(command).toBe("claude 'hi'")
  })

  it('appends --dangerously-skip-permissions for claude-code under autoApprove', () => {
    const { command } = buildAdHocAgentCommand('claude-code', null, 'hi', { autoApprove: true })
    expect(command).toBe("claude --dangerously-skip-permissions 'hi'")
  })

  it('appends --dangerously-bypass-approvals-and-sandbox for codex under autoApprove', () => {
    const { command } = buildAdHocAgentCommand('codex', null, 'hi', { autoApprove: true })
    expect(command).toBe("codex --dangerously-bypass-approvals-and-sandbox 'hi'")
  })

  it('is a no-op for harnesses without a known bypass flag', () => {
    const { command } = buildAdHocAgentCommand('gemini', null, 'hi', { autoApprove: true })
    expect(command).toBe("gemini 'hi'")
  })

  it('places the bypass flag between --model and the prompt', () => {
    const { command } = buildAdHocAgentCommand('claude-code', 'opus', 'hi', { autoApprove: true })
    expect(command).toBe("claude --model opus --dangerously-skip-permissions 'hi'")
  })
})
