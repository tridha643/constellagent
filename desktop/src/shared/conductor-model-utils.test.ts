import { describe, expect, test } from 'bun:test'
import { PLAN_MODEL_PRESETS } from './plan-build-command'
import {
  applyThinkingLevel,
  defaultConductorModel,
  displayModelName,
  hasEffortVariants,
  hasFastVariant,
  mapThinkingLevelToCodexEffort,
  normalizeConductorDefaultProvider,
  parseModelEffort,
  resolveConductorDefaultSelection,
  setModelFast,
  sameModelFamily,
  thinkingLevelFromModel,
  toConductorDraftSelection,
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
    expect(hasEffortVariants('gpt-5.3-codex', 'codex')).toBe(true)
  })

  test('composer-2 has no effort variants on cursor', () => {
    expect(hasEffortVariants('composer-2', 'cursor')).toBe(false)
  })
})

describe('mapThinkingLevelToCodexEffort', () => {
  test('maps thinking levels to Codex SDK effort', () => {
    expect(mapThinkingLevelToCodexEffort('minimal')).toBe('minimal')
    expect(mapThinkingLevelToCodexEffort('high')).toBe('high')
    expect(mapThinkingLevelToCodexEffort('xhigh')).toBe('xhigh')
    expect(mapThinkingLevelToCodexEffort('medium')).toBe('medium')
    expect(mapThinkingLevelToCodexEffort('low')).toBe('low')
  })
})

describe('thinkingLevelFromModel', () => {
  test('reads suffix from model id', () => {
    expect(thinkingLevelFromModel('gpt-5.3-codex-xhigh')).toBe('xhigh')
    expect(thinkingLevelFromModel('gpt-5.3-codex')).toBe('medium')
  })
})

describe('hasFastVariant', () => {
  test('codex exposes fast toggle for model families with known fast variants', () => {
    expect(hasFastVariant('gpt-5.3-codex', 'codex')).toBe(true)
    expect(hasFastVariant('gpt-5.3-codex-fast', 'codex')).toBe(true)
    expect(hasFastVariant('gpt-5.5', 'codex')).toBe(true)
    expect(hasFastVariant('gpt-5.5-fast', 'codex')).toBe(true)
  })

  test('codex hides fast toggle when no fast variant is known', () => {
    expect(hasFastVariant('gpt-5.4-mini', 'codex')).toBe(false)
  })

  test('codex fast support is explicit for every current Codex preset', () => {
    const expectedFastModels = new Set([
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.3-codex',
      'gpt-5.2-codex',
      'gpt-5.2',
      'gpt-5.1-codex-max',
    ])
    const actual = Object.fromEntries(
      PLAN_MODEL_PRESETS.codex.map((preset) => [
        preset.cliModel,
        hasFastVariant(preset.cliModel, 'codex'),
      ]),
    )

    for (const preset of PLAN_MODEL_PRESETS.codex) {
      expect(actual[preset.cliModel]).toBe(expectedFastModels.has(preset.cliModel))
    }
  })

  test('composer-2 supports fast toggle on cursor', () => {
    expect(hasFastVariant('composer-2', 'cursor')).toBe(true)
    expect(hasFastVariant('composer-2-fast', 'cursor')).toBe(true)
  })

  test('composer-2.5 supports fast toggle on cursor', () => {
    expect(hasFastVariant('composer-2.5', 'cursor')).toBe(true)
    expect(hasFastVariant('composer-2.5-fast', 'cursor')).toBe(true)
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

describe('Conductor defaults', () => {
  test('falls back to cursor for invalid providers', () => {
    expect(normalizeConductorDefaultProvider('nope')).toBe('cursor')
    expect(normalizeConductorDefaultProvider('codex')).toBe('codex')
    expect(normalizeConductorDefaultProvider('pi')).toBe('pi')
  })

  test('resolves blank codex defaults to the provider preset', () => {
    expect(resolveConductorDefaultSelection('codex', '').model).toBe(defaultConductorModel('codex'))
  })

  test('uses Pi default model placeholder without fast variants', () => {
    expect(defaultConductorModel('pi')).toBe('')
    expect(resolveConductorDefaultSelection('pi', '').model).toBe('')
    expect(hasFastVariant('', 'pi')).toBe(false)
  })

  test('converts stored model ids into draft model + thinking level', () => {
    expect(toConductorDraftSelection('gpt-5.3-codex-high-fast')).toEqual({
      model: 'gpt-5.3-codex-fast',
      thinkingLevel: 'high',
    })
  })

  test('uses configured default thinking level when set', () => {
    expect(resolveConductorDefaultSelection('codex', 'gpt-5.4', 'high')).toEqual({
      model: 'gpt-5.4',
      thinkingLevel: 'high',
    })
  })
})
