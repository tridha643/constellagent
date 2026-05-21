import { describe, expect, test } from 'bun:test'
import {
  buildSubagentMetadata,
  isSubagentTool,
  parseSubagentInput,
  parseSubagentMetadata,
  subagentStatusHint,
  subagentToolLabel,
} from './conductor-subagent-utils'

describe('isSubagentTool', () => {
  test('matches Task harness names', () => {
    expect(isSubagentTool('Task')).toBe(true)
    expect(isSubagentTool('explore')).toBe(true)
    expect(isSubagentTool('read')).toBe(false)
  })
})

describe('parseSubagentInput', () => {
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
  })
})
