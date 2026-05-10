import { describe, expect, test } from 'bun:test'
import {
  prInfoFromExtracted,
  summarizeComposioPayloadForAgent,
  tryExtractGithubPrMergeFromComposioBody,
} from './composio-payload'
import { mergeDedupeKeyForGithubPr, shouldEmitMergeDedupeKey } from './automation-merge-dedupe'

describe('composio-payload', () => {
  test('extracts merged PR from GitHub-shaped body', () => {
    const extracted = tryExtractGithubPrMergeFromComposioBody({
      pull_request: {
        number: 42,
        merged: true,
        merged_at: '2026-01-01T00:00:00Z',
        title: 'Fix thing',
        html_url: 'https://github.com/acme/rocket/pull/42',
        head: {
          ref: 'feature/x',
          repo: { full_name: 'acme/rocket', name: 'rocket', owner: { login: 'acme' } },
        },
        base: {
          ref: 'main',
          repo: { full_name: 'acme/rocket' },
        },
      },
    })
    expect(extracted).not.toBeNull()
    expect(extracted?.owner).toBe('acme')
    expect(extracted?.repo).toBe('rocket')
    expect(extracted?.headBranch).toBe('feature/x')
    const pr = prInfoFromExtracted(extracted!)
    expect(pr.state).toBe('merged')
    expect(pr.number).toBe(42)
  })

  test('extracts from data.pull_request wrapper', () => {
    const extracted = tryExtractGithubPrMergeFromComposioBody({
      data: {
        pull_request: {
          number: 7,
          merged_at: '2026-05-01T12:00:00Z',
          title: 'W',
          head: { ref: 'b1', repo: { full_name: 'o/r' } },
        },
      },
    })
    expect(extracted?.owner).toBe('o')
    expect(extracted?.repo).toBe('r')
  })

  test('unwraps composio.trigger.message and extracts nested pull_request', () => {
    const extracted = tryExtractGithubPrMergeFromComposioBody({
      type: 'composio.trigger.message',
      metadata: { trigger_slug: 'GITHUB_PULL_REQUEST_EVENT' },
      data: {
        pull_request: {
          number: 10,
          merged: true,
          merged_at: '2026-02-01T00:00:00Z',
          title: 'Via envelope',
          html_url: 'https://github.com/x/y/pull/10',
          head: { ref: 'feat', repo: { full_name: 'x/y' } },
        },
      },
    })
    expect(extracted?.owner).toBe('x')
    expect(extracted?.headBranch).toBe('feat')
    expect(extracted?.pullRequest.number).toBe(10)
  })

  test('extracts flat PR merge from composio.trigger.message data (no nested pull_request)', () => {
    const extracted = tryExtractGithubPrMergeFromComposioBody({
      type: 'composio.trigger.message',
      data: {
        action: 'closed',
        merged: true,
        number: 147,
        title: 'Smoke',
        url: 'https://github.com/tridha643/constellagent/pull/147',
        head_ref: 'verify/composio-merge-smoke',
      },
    })
    expect(extracted).not.toBeNull()
    expect(extracted?.owner).toBe('tridha643')
    expect(extracted?.repo).toBe('constellagent')
    expect(extracted?.headBranch).toBe('verify/composio-merge-smoke')
    expect(extracted?.pullRequest.number).toBe(147)
  })

  test('flat merge returns null without head branch', () => {
    expect(
      tryExtractGithubPrMergeFromComposioBody({
        type: 'composio.trigger.message',
        data: {
          merged: true,
          url: 'https://github.com/o/r/pull/1',
        },
      }),
    ).toBeNull()
  })

  test('returns null when not merged', () => {
    expect(
      tryExtractGithubPrMergeFromComposioBody({
        pull_request: { number: 1, state: 'open', head: { ref: 'a', repo: { full_name: 'o/r' } } },
      }),
    ).toBeNull()
  })

  test('summarize includes Gmail-like fields and redacts secrets', () => {
    const s = summarizeComposioPayloadForAgent({
      type: 'composio.trigger.message',
      data: {
        subject: 'Please fix the bug',
        sender: 'you@example.com',
        message_text: 'Hello\nWorld',
        access_token: 'SECRET',
        message_id: 'abc123',
      },
    })
    expect(s).toContain('subject')
    expect(s).toContain('Please fix the bug')
    expect(s).toContain('abc123')
    expect(s).not.toContain('SECRET')
  })

  test('summarize formats merged PR', () => {
    const s = summarizeComposioPayloadForAgent({
      type: 'composio.trigger.message',
      data: {
        action: 'closed',
        merged: true,
        number: 147,
        title: 'Smoke',
        url: 'https://github.com/tridha643/constellagent/pull/147',
        head_ref: 'verify/composio-merge-smoke',
      },
    })
    expect(s).toContain('PR merged')
    expect(s).toContain('#147')
    expect(s).toContain('verify/composio-merge-smoke')
  })

  test('returns null-safe empty for undefined', () => {
    expect(summarizeComposioPayloadForAgent(undefined)).toBe('')
  })
})

describe('automation-merge-dedupe', () => {
  test('dedupes same key within window', () => {
    const k = mergeDedupeKeyForGithubPr('Acme/Repo', 99)
    expect(shouldEmitMergeDedupeKey(k)).toBe(true)
    expect(shouldEmitMergeDedupeKey(k)).toBe(false)
    const k2 = mergeDedupeKeyForGithubPr('other/repo', 1)
    expect(shouldEmitMergeDedupeKey(k2)).toBe(true)
  })
})
