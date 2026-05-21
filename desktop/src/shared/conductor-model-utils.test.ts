import { describe, expect, test } from 'bun:test'
import {
  applyThinkingLevel,
  displayModelName,
  hasEffortVariants,
  hasFastVariant,
  parseModelEffort,
  setModelFast,
  sameModelFamily,
  thinkingLevelFromModel,
} from './conductor-model-utils'

describe('parseModelEffort', () => {
  test('parses effort and speed suffixes', () => {
    expect(parseModelEffort('gpt-5.3-codex-low-fast')).toEqual({
      base: 'gpt-5.3-codex',
      effortSuffix: 'low',
      speedSuffix: 'fast',
    })
  })

  test('parses base model without suffixes', () => {
    expect(parseModelEffort('composer-2')).toEqual({ base: 'composer-2' })
  })

  test('parses fast-only suffix', () => {
    expect(parseModelEffort('composer-2-fast')).toEqual({
      base: 'composer-2',
      speedSuffix: 'fast',
    })
  })
})

describe('applyThinkingLevel', () => {
  test('maps low to -low variant', () => {
    expect(applyThinkingLevel('gpt-5.3-codex', 'low')).toBe('gpt-5.3-codex-low')
  })

  test('maps high keeping fast suffix', () => {
    expect(applyThinkingLevel('gpt-5.3-codex-low-fast', 'high')).toBe('gpt-5.3-codex-high-fast')
  })

  test('medium maps to base model', () => {
    expect(applyThinkingLevel('gpt-5.3-codex-high', 'medium')).toBe('gpt-5.3-codex')
  })
})

describe('hasEffortVariants', () => {
  test('codex family has variants', () => {
    expect(hasEffortVariants('gpt-5.3-codex')).toBe(true)
  })

  test('composer-2 has no effort variants', () => {
    expect(hasEffortVariants('composer-2')).toBe(false)
  })
})

describe('thinkingLevelFromModel', () => {
  test('reads suffix from model id', () => {
    expect(thinkingLevelFromModel('gpt-5.3-codex-xhigh')).toBe('xhigh')
    expect(thinkingLevelFromModel('gpt-5.3-codex')).toBe('medium')
  })
})

describe('hasFastVariant', () => {
  test('codex family has fast variant', () => {
    expect(hasFastVariant('gpt-5.3-codex')).toBe(true)
    expect(hasFastVariant('gpt-5.3-codex-fast')).toBe(true)
  })

  test('composer-2 supports fast toggle', () => {
    expect(hasFastVariant('composer-2')).toBe(true)
    expect(hasFastVariant('composer-2-fast')).toBe(true)
  })
})

describe('setModelFast', () => {
  test('toggles base and base-fast', () => {
    expect(setModelFast('gpt-5.3-codex', true)).toBe('gpt-5.3-codex-fast')
    expect(setModelFast('gpt-5.3-codex-fast', false)).toBe('gpt-5.3-codex')
    expect(setModelFast('gpt-5.3-codex-high', true)).toBe('gpt-5.3-codex-fast')
  })
})

describe('applyThinkingLevel with fast', () => {
  test('combines fast suffix with effort level for codex', () => {
    expect(applyThinkingLevel('gpt-5.3-codex-fast', 'low')).toBe('gpt-5.3-codex-low-fast')
    expect(applyThinkingLevel('gpt-5.3-codex-fast', 'high')).toBe('gpt-5.3-codex-high-fast')
  })
})

describe('displayModelName', () => {
  test('strips effort words', () => {
    expect(displayModelName('GPT-5.3 Codex Low Fast')).toBe('GPT-5.3 Codex')
    expect(displayModelName('Composer 2 Fast')).toBe('Composer 2')
  })
})
