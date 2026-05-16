import { describe, expect, it } from 'bun:test'
import { buildAdHocAgentCommand } from './plan-build-command'

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
