import { describe, expect, test } from 'bun:test'
import { PI_CONDUCTOR_MODEL_PRESETS } from './conductor-model-utils'
import {
  buildPiConductorModelPresets,
  filterPresetsToResolvable,
  mergeModelPresets,
  piCliModelsToPresets,
  resolveStoredPiModelId,
  resolvablePiModelIds,
  runtimeModelsToPresets,
  stripMisassignedOpenAiPresets,
} from './pi-conductor-model-presets'

const OPENAI_CODEX_GPT_55 = {
  providerId: 'openai-codex',
  providerName: 'OpenAI Codex',
  modelId: 'gpt-5.5',
  label: 'GPT-5.5',
  available: true,
}

describe('buildPiConductorModelPresets', () => {
  test('merges pi CLI models and runtime models without duplicates', () => {
    const presets = buildPiConductorModelPresets({
      staticPresets: PI_CONDUCTOR_MODEL_PRESETS,
      cliModels: [{ provider: 'openai-codex', model: 'gpt-5.5', id: 'openai-codex/gpt-5.5' }],
      runtimeModels: [
        OPENAI_CODEX_GPT_55,
        {
          providerId: 'anthropic',
          providerName: 'Anthropic',
          modelId: 'claude-sonnet-4-5',
          label: 'Claude Sonnet 4.5',
          available: true,
        },
      ],
      enabledModelPatterns: ['anthropic/claude-sonnet-4-5'],
    })

    expect(presets).toContainEqual({
      label: 'openai-codex / gpt-5.5',
      cliModel: 'openai-codex/gpt-5.5',
    })
    expect(presets).toContainEqual({
      label: 'Anthropic / Claude Sonnet 4.5',
      cliModel: 'anthropic/claude-sonnet-4-5',
    })
    expect(presets.filter((preset) => preset.cliModel === 'openai-codex/gpt-5.5')).toHaveLength(1)
  })

  test('keeps CLI-only models even when the embedded SDK registry has not caught up', () => {
    const presets = buildPiConductorModelPresets({
      staticPresets: [{ label: 'OpenAI / GPT-5.5', cliModel: 'openai/gpt-5.5' }],
      cliModels: [{ provider: 'openai-codex', model: 'gpt-5.5', id: 'openai-codex/gpt-5.5' }],
      runtimeModels: [],
    })

    expect(presets.some((preset) => preset.cliModel === 'openai/gpt-5.5')).toBe(false)
    expect(presets).toContainEqual({
      label: 'openai-codex / gpt-5.5',
      cliModel: 'openai-codex/gpt-5.5',
    })
  })
})

describe('runtimeModelsToPresets', () => {
  test('respects enabled model patterns like the Pi terminal composer', () => {
    const presets = runtimeModelsToPresets(
      [
        OPENAI_CODEX_GPT_55,
        {
          providerId: 'anthropic',
          providerName: 'Anthropic',
          modelId: 'claude-sonnet-4-5',
          label: 'Claude Sonnet 4.5',
          available: true,
        },
      ],
      ['openai-codex/gpt-5.5'],
    )

    expect(presets).toEqual([
      { label: 'OpenAI Codex / GPT-5.5', cliModel: 'openai-codex/gpt-5.5' },
    ])
  })
})

describe('filterPresetsToResolvable', () => {
  test('keeps Pi default and registry-backed models only', () => {
    const resolvable = resolvablePiModelIds([OPENAI_CODEX_GPT_55])
    expect(
      filterPresetsToResolvable(
        [
          { label: 'Pi default', cliModel: '' },
          { label: 'Bad', cliModel: 'openai/gpt-5.5' },
          { label: 'Good', cliModel: 'openai-codex/gpt-5.5' },
        ],
        resolvable,
      ),
    ).toEqual([
      { label: 'Pi default', cliModel: '' },
      { label: 'Good', cliModel: 'openai-codex/gpt-5.5' },
    ])
  })
})

describe('stripMisassignedOpenAiPresets', () => {
  test('removes openai/<id> when openai-codex/<id> exists', () => {
    expect(
      stripMisassignedOpenAiPresets([
        { label: 'OpenAI / GPT-5.5', cliModel: 'openai/gpt-5.5' },
        { label: 'OpenAI Codex / GPT-5.5', cliModel: 'openai-codex/gpt-5.5' },
      ]),
    ).toEqual([{ label: 'OpenAI Codex / GPT-5.5', cliModel: 'openai-codex/gpt-5.5' }])
  })
})

describe('resolveStoredPiModelId', () => {
  test('maps legacy openai/gpt-5.5 to openai-codex/gpt-5.5 via the CLI catalog', () => {
    const cliModels = [{ provider: 'openai-codex', model: 'gpt-5.5', id: 'openai-codex/gpt-5.5' }]
    expect(resolveStoredPiModelId('openai/gpt-5.5', [], cliModels)).toBe('openai-codex/gpt-5.5')
    expect(resolveStoredPiModelId('gpt-5.5', [], cliModels)).toBe('openai-codex/gpt-5.5')
  })

  test('prefers runtime-resolvable ids when both CLI and runtime agree', () => {
    expect(
      resolveStoredPiModelId('openai-codex/gpt-5.5', [OPENAI_CODEX_GPT_55], [
        { provider: 'openai-codex', model: 'gpt-5.5', id: 'openai-codex/gpt-5.5' },
      ]),
    ).toBe('openai-codex/gpt-5.5')
  })
})

describe('mergeModelPresets', () => {
  test('dedupes by cliModel preserving first label', () => {
    expect(
      mergeModelPresets(
        [{ label: 'OpenAI Codex / GPT-5.5', cliModel: 'openai-codex/gpt-5.5' }],
        piCliModelsToPresets([{ provider: 'openai-codex', model: 'gpt-5.5', id: 'openai-codex/gpt-5.5' }]),
      ),
    ).toEqual([{ label: 'OpenAI Codex / GPT-5.5', cliModel: 'openai-codex/gpt-5.5' }])
  })
})
