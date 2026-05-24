import type { ModelPreset, PiModelOption } from './plan-build-command'
import { formatPiModelOptionLabel, normalizePiModelOptions, pickPiModelIdForCli } from './pi-models'

export interface PiRuntimeModelRecord {
  readonly providerId: string
  readonly providerName: string
  readonly modelId: string
  readonly label: string
  readonly available: boolean
}

export function mergeModelPresets(...groups: readonly (readonly ModelPreset[])[]): ModelPreset[] {
  const seen = new Set<string>()
  const out: ModelPreset[] = []

  for (const group of groups) {
    for (const preset of group) {
      if (seen.has(preset.cliModel)) continue
      seen.add(preset.cliModel)
      out.push(preset)
    }
  }

  return out
}

/** Match Pi terminal composer model filtering (enabled-model patterns when configured). */
export function runtimeModelsToPresets(
  models: readonly PiRuntimeModelRecord[],
  enabledModelPatterns: readonly string[] = [],
): ModelPreset[] {
  const allAvailable = enabledModelPatterns.length === 0
  const enabledSet = allAvailable ? undefined : new Set(enabledModelPatterns)

  return models
    .filter((model) => {
      if (!model.available) return false
      if (!enabledSet) return true
      return enabledSet.has(`${model.providerId}/${model.modelId}`)
    })
    .map((model) => ({
      label: `${model.providerName || model.providerId} / ${model.label || model.modelId}`,
      cliModel: `${model.providerId}/${model.modelId}`,
    }))
}

export function piCliModelsToPresets(models: readonly PiModelOption[]): ModelPreset[] {
  return normalizePiModelOptions(models).map((model) => ({
    label: formatPiModelOptionLabel(model),
    cliModel: model.id,
  }))
}

/** Pi SDK only accepts provider/model ids present in the runtime registry (see session-supervisor resolveModel). */
export function filterPresetsToResolvable(
  presets: readonly ModelPreset[],
  resolvableIds: ReadonlySet<string>,
): ModelPreset[] {
  return presets.filter((preset) => preset.cliModel === '' || resolvableIds.has(preset.cliModel))
}

export function resolvablePiModelIds(models: readonly PiRuntimeModelRecord[]): Set<string> {
  const ids = new Set<string>()
  for (const model of models) {
    if (!model.available) continue
    ids.add(`${model.providerId}/${model.modelId}`)
  }
  return ids
}

/** Drop legacy `openai/<id>` presets when `openai-codex/<id>` is present (Pi CLI provider split). */
export function stripMisassignedOpenAiPresets(presets: readonly ModelPreset[]): ModelPreset[] {
  const codexModelIds = new Set(
    presets
      .filter((preset) => preset.cliModel.startsWith('openai-codex/'))
      .map((preset) => preset.cliModel.slice('openai-codex/'.length)),
  )

  return presets.filter((preset) => {
    if (!preset.cliModel.startsWith('openai/')) return true
    const modelId = preset.cliModel.slice('openai/'.length)
    return !codexModelIds.has(modelId)
  })
}

export function buildPiConductorModelPresets(input: {
  readonly staticPresets: readonly ModelPreset[]
  readonly runtimeModels: readonly PiRuntimeModelRecord[]
  readonly enabledModelPatterns?: readonly string[]
  readonly cliModels?: readonly PiModelOption[]
}): ModelPreset[] {
  const resolvable = resolvablePiModelIds(input.runtimeModels)
  const cliPresets = piCliModelsToPresets(input.cliModels ?? [])
  const runtimePresets = filterPresetsToResolvable(
    runtimeModelsToPresets(input.runtimeModels, input.enabledModelPatterns ?? []),
    resolvable,
  )
  const staticPresets = filterPresetsToResolvable(input.staticPresets, resolvable)

  // CLI catalog is authoritative for the picker (matches `pi --list-models` / Pi terminal).
  // Runtime/static entries are still filtered so we do not offer ids the embedded SDK cannot resolve.
  return stripMisassignedOpenAiPresets(mergeModelPresets(cliPresets, runtimePresets, staticPresets))
}

export function resolveStoredPiModelId(
  model: string,
  runtimeModels: readonly PiRuntimeModelRecord[],
  cliModels: readonly PiModelOption[] = [],
): string {
  const trimmed = model.trim()
  if (!trimmed) return ''

  const resolvable = resolvablePiModelIds(runtimeModels)
  const normalizedCli = normalizePiModelOptions(cliModels)
  const picked = pickFromCliOrRuntime(trimmed, normalizedCli, resolvable)
  if (picked) return picked

  if (resolvable.has(trimmed)) return trimmed
  return ''
}

function pickFromCliOrRuntime(
  preferred: string,
  cliModels: readonly PiModelOption[],
  resolvable: ReadonlySet<string>,
): string {
  if (cliModels.length === 0) {
    return resolvable.has(preferred) ? preferred : ''
  }

  const picked = pickPiModelIdForCli(cliModels, preferred)
  if (resolvable.has(picked)) return picked

  const cliIds = new Set(cliModels.map((model) => model.id))
  return cliIds.has(picked) ? picked : ''
}
