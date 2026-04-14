import { describe, expect, it } from 'bun:test'
import type { PiModelOption } from './plan-build-command'
import {
  PI_MODEL_CACHE_VERSION,
  parsePiListModels,
  parsePiListModelsOrThrow,
  resolvePiModelSelectState,
  resolvePiModelList,
} from './pi-models'

const RUNTIME_MODELS: PiModelOption[] = [
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    id: 'anthropic/claude-sonnet-4-5',
  },
  {
    provider: 'google',
    model: 'gemini-2-5-pro',
    id: 'google/gemini-2-5-pro',
  },
]

describe('parsePiListModels', () => {
  it('parses plain provider/model rows and removes duplicates', () => {
    const stdout = `
provider      model                 aliases
------------  --------------------  -------
anthropic     claude-sonnet-4-5     default
google        gemini-2-5-pro
anthropic     claude-sonnet-4-5     latest
`

    expect(parsePiListModels(stdout)).toEqual(RUNTIME_MODELS)
  })

  it('tolerates banner noise, ansi escapes, and provider-qualified ids', () => {
    const stdout = `
\u001b[33mUsing ~/.pi/config.json\u001b[0m
Available models
anthropic/claude-sonnet-4-5    Latest
| google | gemini-2-5-pro | Preview |
warning: cached credentials expired
`

    expect(parsePiListModels(stdout)).toEqual(RUNTIME_MODELS)
  })

  it('treats an explicit no-models response as an empty result', () => {
    expect(parsePiListModelsOrThrow('No models available right now')).toEqual([])
  })

  it('parses rows when the runtime sends the table on stderr only (pi when stdout is not a TTY)', () => {
    const stderr = `
provider      model                        context
anthropic     claude-sonnet-4-5            200K
google        gemini-2-5-pro              200K
`
    expect(parsePiListModels(stderr)).toEqual([
      { provider: 'anthropic', model: 'claude-sonnet-4-5', id: 'anthropic/claude-sonnet-4-5' },
      { provider: 'google', model: 'gemini-2-5-pro', id: 'google/gemini-2-5-pro' },
    ])
  })
})

describe('resolvePiModelSelectState', () => {
  it('builds deduplicated PI select options with readable labels and raw ids', () => {
    const state = resolvePiModelSelectState([
      RUNTIME_MODELS[0],
      { ...RUNTIME_MODELS[0] },
      RUNTIME_MODELS[1],
    ], null)

    expect(state).toEqual({
      presets: [
        {
          label: 'anthropic / claude-sonnet-4-5',
          cliModel: 'anthropic/claude-sonnet-4-5',
        },
        {
          label: 'google / gemini-2-5-pro',
          cliModel: 'google/gemini-2-5-pro',
        },
      ],
      value: '',
      hasSelectedPreset: false,
    })
  })

  it('canonicalizes saved provider-qualified values before matching them to the loaded list', () => {
    const state = resolvePiModelSelectState(RUNTIME_MODELS, ' Anthropic / CLAUDE-SONNET-4-5 ')

    expect(state.value).toBe('anthropic/claude-sonnet-4-5')
    expect(state.hasSelectedPreset).toBe(true)
  })

  it('keeps an existing saved PI model visible even if it is missing from the latest list', () => {
    const state = resolvePiModelSelectState(RUNTIME_MODELS, 'openrouter/custom-pi-model')

    expect(state.value).toBe('openrouter/custom-pi-model')
    expect(state.hasSelectedPreset).toBe(false)
  })
})

describe('resolvePiModelList', () => {
  it('returns a fresh cache hit without calling runtime', async () => {
    let runtimeCalls = 0

    const models = await resolvePiModelList({
      readCache: async () => ({
        version: PI_MODEL_CACHE_VERSION,
        fetchedAt: 9_500,
        models: RUNTIME_MODELS,
      }),
      writeCache: async () => {
        throw new Error('should not write cache')
      },
      fetchRuntimeModels: async () => {
        runtimeCalls += 1
        return []
      },
      now: () => 10_000,
      cacheTtlMs: 1_000,
    })

    expect(models).toEqual(RUNTIME_MODELS)
    expect(runtimeCalls).toBe(0)
  })

  it('refreshes a stale cache and writes back the new runtime result', async () => {
    let written: unknown = null

    const models = await resolvePiModelList({
      readCache: async () => ({
        version: PI_MODEL_CACHE_VERSION,
        fetchedAt: 1_000,
        models: [
          {
            provider: 'openai',
            model: 'gpt-5',
            id: 'openai/gpt-5',
          },
        ],
      }),
      writeCache: async (record) => {
        written = record
      },
      fetchRuntimeModels: async () => RUNTIME_MODELS,
      now: () => 10_000,
      cacheTtlMs: 1_000,
    })

    expect(models).toEqual(RUNTIME_MODELS)
    expect(written).toEqual({
      version: PI_MODEL_CACHE_VERSION,
      fetchedAt: 10_000,
      models: RUNTIME_MODELS,
    })
  })

  it('falls back to the stale cache when runtime refresh fails', async () => {
    const staleCache = {
      version: PI_MODEL_CACHE_VERSION,
      fetchedAt: 1_000,
      models: [
        {
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          id: 'anthropic/claude-haiku-4-5',
        },
      ],
    }

    const models = await resolvePiModelList({
      readCache: async () => staleCache,
      writeCache: async () => {
        throw new Error('should not write cache')
      },
      fetchRuntimeModels: async () => {
        throw new Error('pi unavailable')
      },
      now: () => 10_000,
      cacheTtlMs: 1_000,
    })

    expect(models).toEqual(staleCache.models)
  })

  it('rethrows the runtime error when there is no usable cache', async () => {
    await expect(resolvePiModelList({
      readCache: async () => null,
      writeCache: async () => {},
      fetchRuntimeModels: async () => {
        throw new Error('pi unavailable')
      },
    })).rejects.toThrow('pi unavailable')
  })
})
