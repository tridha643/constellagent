import { describe, expect, it } from 'bun:test'
import { parseCursorAgentListModels, parseCursorAgentListModelsOrThrow } from './cursor-cli-models'
import {
  isKnownCursorCloudModel,
  isKnownCursorCliModel,
  shouldBypassCursorSdkModelValidation,
} from './cursor-sdk-model'

const SAMPLE_CURSOR_LIST = `
Available models

auto - Auto
composer-2-fast - Composer 2 Fast
composer-2.5 - Composer 2.5
composer-2.5-fast - Composer 2.5 Fast (current, default)
gpt-5.3-codex - Codex 5.3
`

describe('parseCursorAgentListModels', () => {
  it('parses cursor-agent --list-models rows', () => {
    expect(parseCursorAgentListModels(SAMPLE_CURSOR_LIST)).toEqual([
      'auto',
      'composer-2-fast',
      'composer-2.5',
      'composer-2.5-fast',
      'gpt-5.3-codex',
    ])
  })

  it('throws when output cannot be parsed', () => {
    expect(() => parseCursorAgentListModelsOrThrow('something went wrong')).toThrow(
      'Unable to parse `cursor-agent --list-models` output',
    )
  })
})

describe('shouldBypassCursorSdkModelValidation', () => {
  const catalog = {
    cloudIds: new Set(['composer-2.5', 'composer-2-fast']),
    cloudAliases: new Set<string>(),
    cliIds: new Set(['composer-2.5', 'composer-2.5-fast', 'composer-2-fast']),
  }

  it('bypasses when CLI exposes a model the cloud catalog has not caught up with', () => {
    expect(
      shouldBypassCursorSdkModelValidation('composer-2.5-fast', {
        apiKey: 'key',
        hasCliLogin: true,
        catalog,
      }),
    ).toBe(true)
  })

  it('does not bypass when the cloud catalog already knows the model', () => {
    expect(
      shouldBypassCursorSdkModelValidation('composer-2-fast', {
        apiKey: 'key',
        hasCliLogin: true,
        catalog,
      }),
    ).toBe(false)
  })

  it('does not bypass without cursor-agent login', () => {
    expect(
      shouldBypassCursorSdkModelValidation('composer-2.5-fast', {
        apiKey: 'key',
        hasCliLogin: false,
        catalog,
      }),
    ).toBe(false)
  })

  it('recognizes cloud aliases', () => {
    const aliasedCatalog = {
      cloudIds: new Set(['composer-2.5']),
      cloudAliases: new Set(['composer-2.5-fast']),
      cliIds: new Set(['composer-2.5-fast']),
    }
    expect(isKnownCursorCloudModel('composer-2.5-fast', aliasedCatalog)).toBe(true)
    expect(isKnownCursorCliModel('composer-2.5-fast', aliasedCatalog)).toBe(true)
    expect(
      shouldBypassCursorSdkModelValidation('composer-2.5-fast', {
        apiKey: 'key',
        hasCliLogin: true,
        catalog: aliasedCatalog,
      }),
    ).toBe(false)
  })
})
