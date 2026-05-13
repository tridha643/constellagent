import { describe, expect, it } from 'vitest'
import { formatLinearIssueAgentPrompt, type LinearIssueNode } from './linear-api'

describe('formatLinearIssueAgentPrompt', () => {
  it('hardens the prompt around read-only planning for the ticket', () => {
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
    expect(prompt).toContain('Perform a read-only kickoff investigation for Linear ticket AGI-107')
    expect(prompt).toContain('HARD READ-ONLY RULES:')
    expect(prompt).toContain('Do not edit files, create files, delete files, rename files, format files, or apply patches.')
    expect(prompt).toContain('Do not use write-capable tools or commands')
    expect(prompt).toContain('Do not change dependencies, configuration, generated artifacts')
    expect(prompt).toContain('Use mandatory specialist subagents for parallel read-only investigation')
    expect(prompt).toContain('FINAL OUTPUT ONLY:')
    expect(prompt).toContain('Proposed plan: phased implementation steps')
    expect(prompt).toContain('ASCII control-flow diagram')
    expect(prompt).toContain('DESCRIPTION:')
    expect(prompt).toContain(issue.description!)
    expect(prompt).not.toContain('Make the code changes')
    expect(prompt).not.toContain('Implement the work requested')
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
