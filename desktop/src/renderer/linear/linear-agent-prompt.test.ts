import { describe, expect, it } from 'vitest'
import { formatLinearIssueAgentPrompt, type LinearIssueNode } from './linear-api'

describe('formatLinearIssueAgentPrompt', () => {
  it('hardens the prompt around implementing the ticket', () => {
    const issue: LinearIssueNode = {
      id: 'issue-1',
      identifier: 'AGI-107',
      title: 'Write API error code reference',
      description: 'Implement the docs and code changes required for the API error code reference flow.',
      url: 'https://linear.app/example/issue/AGI-107',
      state: { name: 'Backlog', type: 'backlog' },
      team: { id: 'team-1', key: 'AGI', name: 'AGI labs' },
      project: { id: 'project-1', name: 'Docs' },
    }

    const prompt = formatLinearIssueAgentPrompt(issue)

    expect(prompt).toContain('PRIMARY OBJECTIVE:')
    expect(prompt).toContain('Implement the work requested by this Linear ticket: AGI-107.')
    expect(prompt).toContain('Do not wander into broad refactors')
    expect(prompt).toContain('PREFERRED EXECUTION ORDER:')
    expect(prompt).toContain('Success means the codebase meaningfully advances or completes this exact ticket.')
    expect(prompt).toContain('DESCRIPTION:')
    expect(prompt).toContain(issue.description!)
  })

  it('fills in sensible fallbacks when metadata is missing', () => {
    const issue: LinearIssueNode = {
      id: 'issue-2',
      identifier: 'AGI-108',
      title: 'Publish SDKs to PyPI and npm',
      url: 'https://linear.app/example/issue/AGI-108',
      state: null,
      team: null,
    }

    const prompt = formatLinearIssueAgentPrompt(issue)

    expect(prompt).toContain('State: Unknown')
    expect(prompt).toContain('Team: Unknown team')
    expect(prompt).toContain('Project: No project')
    expect(prompt).toContain('(No additional issue description provided.)')
  })
})
