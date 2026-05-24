import { describe, expect, test } from 'bun:test'
import {
  buildSubagentMetadata,
  collabAgentStatusLabel,
  isSubagentTool,
  mergeSubagentResultMetadata,
  parseCodexSpawnPrompt,
  parseSubagentInput,
  parseSubagentMetadata,
  parseSubagentResult,
  subagentStatusHint,
  subagentToolLabel,
  toolCallHarnessName,
} from './conductor-subagent-utils'

describe('isSubagentTool', () => {
  test('matches Task harness names', () => {
    expect(isSubagentTool('Task')).toBe(true)
    expect(isSubagentTool('explore')).toBe(true)
    expect(isSubagentTool('spawn_agent')).toBe(true)
    expect(isSubagentTool('read')).toBe(false)
  })
})

describe('parseCodexSpawnPrompt', () => {
  test('parses JSON spawn prompts with agent_type', () => {
    expect(
      parseCodexSpawnPrompt(
        JSON.stringify({
          agent_type: 'explorer',
          message: 'Search auth module\nMore details',
        }),
      ),
    ).toEqual({
      title: 'Search auth module',
      statusHint: 'Search auth module',
      subagentType: 'explorer',
    })
  })

  test('falls back to first line for plain prompts', () => {
    expect(parseCodexSpawnPrompt('Find fork icon\nMore details')).toEqual({
      title: 'Find fork icon',
      statusHint: 'Find fork icon',
    })
  })
})

describe('collabAgentStatusLabel', () => {
  test('returns human-readable status labels', () => {
    expect(collabAgentStatusLabel('running')).toBe('Running…')
    expect(collabAgentStatusLabel('completed')).toBe('Completed')
  })
})

describe('parseSubagentInput', () => {
  test('parses nested Cursor SDK subagentType object', () => {
    expect(
      parseSubagentInput({
        description: 'Scout codebase',
        prompt: 'Find Conductor files',
        subagentType: { kind: 'explore', name: 'medium' },
        model: 'composer-2',
      }),
    ).toEqual({
      title: 'Scout codebase',
      statusHint: 'Find Conductor files',
      subagentType: 'explore/medium',
      model: 'composer-2',
    })
  })

  test('uses description as title', () => {
    expect(
      parseSubagentInput({
        description: 'Explore copy/fork message UI',
        prompt: 'Search Conductor chat components',
      }),
    ).toEqual({
      title: 'Explore copy/fork message UI',
      statusHint: 'Search Conductor chat components',
      subagentType: undefined,
    })
  })

  test('falls back to prompt first line', () => {
    expect(parseSubagentInput({ prompt: 'Find fork icon\nMore details' })).toEqual({
      title: 'Find fork icon',
      statusHint: 'Find fork icon',
      subagentType: undefined,
    })
  })
})

describe('subagentToolLabel', () => {
  test('returns parsed title', () => {
    expect(subagentToolLabel({ description: 'Parallel explore' })).toBe('Parallel explore')
  })
})

describe('subagentStatusHint', () => {
  test('returns distinct status when prompt differs', () => {
    expect(
      subagentStatusHint({ description: 'Title', prompt: 'Searching files…' }),
    ).toBe('Searching files…')
  })
})

describe('subagent metadata', () => {
  test('builds and parses JSON metadata', () => {
    const json = buildSubagentMetadata(
      { description: 'Explore UI', subagent_type: 'explore' },
      { model: 'composer-2', thinkingLevel: 'low' },
    )
    const parsed = parseSubagentMetadata(json)
    expect(parsed?.variant).toBe('subagent')
    expect(parsed?.subagentType).toBe('explore')
    expect(parsed?.title).toBe('Explore UI')
    expect(parsed?.model).toBe('composer-2')
    expect(parsed?.thinkingLevel).toBe('low')
  })

  test('merges task tool result fields into metadata', () => {
    const base = buildSubagentMetadata({ description: 'Run explore' })
    const merged = mergeSubagentResultMetadata(base, {
      status: 'success',
      value: { agentId: 'bc-child', durationMs: 4200 },
    })
    const parsed = parseSubagentMetadata(merged)
    expect(parsed?.agentId).toBe('bc-child')
    expect(parsed?.durationMs).toBe(4200)
  })
})

describe('toolCallHarnessName', () => {
  test('maps task tool call type to Task harness name', () => {
    expect(toolCallHarnessName({ type: 'task', args: {} })).toBe('Task')
  })
})

describe('parseSubagentResult', () => {
  test('reads agentId and durationMs from success value', () => {
    expect(
      parseSubagentResult({ status: 'success', value: { agentId: 'a1', durationMs: 100 } }),
    ).toEqual({ agentId: 'a1', durationMs: 100 })
  })
})
