import { describe, expect, it } from 'vitest'
import { formatRebaseConflictAgentPrompt } from '../conflict-prompt'

describe('formatRebaseConflictAgentPrompt', () => {
  it('includes the branch, push target, and conflict list', () => {
    const prompt = formatRebaseConflictAgentPrompt({
      branch: 'feature/foo',
      pushRemote: 'origin',
      pushRef: 'feature/foo',
      conflictedFiles: ['src/a.ts', 'src/b.ts'],
    })

    expect(prompt).toContain('Local branch: feature/foo')
    expect(prompt).toContain('Push target: origin/feature/foo')
    expect(prompt).toContain('- src/a.ts')
    expect(prompt).toContain('- src/b.ts')
  })

  it('reminds the agent NOT to push and NOT to abort', () => {
    const prompt = formatRebaseConflictAgentPrompt({
      branch: 'feature/foo',
      pushRemote: 'origin',
      pushRef: 'feature/foo',
      conflictedFiles: ['src/a.ts'],
    })

    expect(prompt).toContain('Do NOT run `git push`')
    expect(prompt).toContain('Do NOT run `git rebase --abort`')
  })

  it('falls back gracefully when no conflicted files were reported', () => {
    const prompt = formatRebaseConflictAgentPrompt({
      branch: 'b',
      pushRemote: 'origin',
      pushRef: 'b',
      conflictedFiles: [],
    })

    expect(prompt).toContain('(no files reported by git status; run `git status` to inspect)')
  })

  it('instructs the agent to git add + git rebase --continue', () => {
    const prompt = formatRebaseConflictAgentPrompt({
      branch: 'b',
      pushRemote: 'origin',
      pushRef: 'b',
      conflictedFiles: ['x'],
    })

    expect(prompt).toContain('git add <file>')
    expect(prompt).toContain('git rebase --continue')
  })
})
