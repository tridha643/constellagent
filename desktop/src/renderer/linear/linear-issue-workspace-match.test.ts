import { describe, expect, it } from 'vitest'
import { workspaceBranchMatchesLinearIssue, type LinearIssueNode } from './linear-api'

function issue(partial: Partial<LinearIssueNode> & Pick<LinearIssueNode, 'id' | 'identifier' | 'title' | 'url'>): LinearIssueNode {
  return {
    state: null,
    team: null,
    ...partial,
  }
}

describe('workspaceBranchMatchesLinearIssue', () => {
  it('matches exact linear/ id slug prefix with dash segment', () => {
    const i = issue({
      id: '1',
      identifier: 'AGI-108',
      title: 'Publish SDKs',
      url: 'u',
    })
    expect(workspaceBranchMatchesLinearIssue(i, 'linear/agi-108-publish-sdks')).toBe(true)
    expect(workspaceBranchMatchesLinearIssue(i, 'linear/agi-108-publish-sdks-wt')).toBe(true)
  })

  it('does not match AGI-10 against AGI-108 branch', () => {
    const ten = issue({ id: '2', identifier: 'AGI-10', title: 'A', url: 'u' })
    expect(workspaceBranchMatchesLinearIssue(ten, 'linear/agi-108-other')).toBe(false)
  })

  it('matches bare linear/idslug when no title segment', () => {
    const i = issue({ id: '3', identifier: 'FOO-1', title: '', url: 'u' })
    expect(workspaceBranchMatchesLinearIssue(i, 'linear/foo-1')).toBe(true)
  })
})
