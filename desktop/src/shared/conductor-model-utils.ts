import type { ModelReasoningEffort } from '@openai/codex-sdk'
import { PLAN_MODEL_PRESETS } from './plan-build-command'
import type { AgentProvider } from './agent-chat-types'
import type { ThinkingLevel } from './conductor-thinking'

const EFFORT_SUFFIXES = ['xhigh', 'high', 'medium', 'low'] as const

export interface ParsedModelEffort {
  readonly base: string
  readonly effortSuffix?: string
  readonly speedSuffix?: 'fast'
}

export interface ConductorDraftSelection {
  readonly model: string
  readonly thinkingLevel: ThinkingLevel
}

export const DEFAULT_CONDUCTOR_PROVIDER: AgentProvider = 'cursor'

function defaultCursorConductorModel(): string {
  const effortPreset = PLAN_MODEL_PRESETS.cursor.find((preset) => {
    if (preset.cliModel === 'auto') return false
    const { base } = parseModelEffort(preset.cliModel)
    return hasEffortVariants(base)
  })
  return effortPreset ? parseModelEffort(effortPreset.cliModel).base : 'composer-2'
}

export function defaultConductorModel(provider: AgentProvider): string {
  if (provider === 'cursor') return defaultCursorConductorModel()
  return PLAN_MODEL_PRESETS[provider].find((preset) => preset.cliModel.trim() !== '')?.cliModel ?? 'gpt-5.5'
}

/** Codex SDK `modelReasoningEffort` — separate from hyphenated Cursor model ids. */
export function mapThinkingLevelToCodexEffort(level: ThinkingLevel): ModelReasoningEffort {
  if (level === 'minimal') return 'minimal'
  return level
}

export function normalizeConductorDefaultProvider(v: unknown): AgentProvider {
  return v === 'codex' ? 'codex' : DEFAULT_CONDUCTOR_PROVIDER
}

export function normalizeConductorDefaultModel(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Strip effort and speed suffixes from a Cursor CLI model id. */
export function parseModelEffort(cliModel: string): ParsedModelEffort {
  let model = cliModel
  let speedSuffix: 'fast' | undefined
  if (model.endsWith('-fast')) {
    speedSuffix = 'fast'
    model = model.slice(0, -5)
  }

  for (const suffix of EFFORT_SUFFIXES) {
    const token = `-${suffix}`
    if (model.endsWith(token)) {
      const base = model.slice(0, -token.length)
      return {
        base,
        effortSuffix: suffix === 'medium' ? undefined : suffix,
        speedSuffix,
      }
    }
  }

  return { base: model, speedSuffix }
}

function cursorPresetIds(): Set<string> {
  return new Set(PLAN_MODEL_PRESETS.cursor.map((p) => p.cliModel))
}

function familyHasFastPreset(base: string, presets: Set<string>): boolean {
  for (const id of presets) {
    const parsed = parseModelEffort(id)
    if (parsed.base === base && parsed.speedSuffix === 'fast') return true
  }
  return false
}

function familyHasNonFastPreset(base: string, presets: Set<string>): boolean {
  for (const id of presets) {
    const parsed = parseModelEffort(id)
    if (parsed.base === base && !parsed.speedSuffix) return true
  }
  return false
}

function codexPresetIds(): Set<string> {
  return new Set(PLAN_MODEL_PRESETS.codex.map((p) => p.cliModel))
}

/** Whether this model family supports a Fast (-fast) variant in CLI presets. */
export function hasFastVariant(cliModel: string, provider: AgentProvider = 'cursor'): boolean {
  if (provider === 'codex') return false
  const { base, speedSuffix } = parseModelEffort(cliModel)
  const presets = cursorPresetIds()
  return speedSuffix === 'fast'
    ? familyHasNonFastPreset(base, presets)
    : familyHasFastPreset(base, presets)
}

/** Toggle stored model id between base and base-fast (effort applied separately). */
export function setModelFast(cliModel: string, fast: boolean): string {
  const { base } = parseModelEffort(cliModel)
  return fast ? `${base}-fast` : base
}

/** Whether the Effort control applies for this provider + model family. */
export function hasEffortVariants(cliModel: string, provider: AgentProvider = 'cursor'): boolean {
  const { base } = parseModelEffort(cliModel)
  if (provider === 'codex') {
    return [...codexPresetIds()].some((id) => parseModelEffort(id).base === base)
  }
  const { speedSuffix } = parseModelEffort(cliModel)
  const presets = cursorPresetIds()
  const speed = speedSuffix ? '-fast' : ''
  return (
    presets.has(`${base}-low${speed}`) ||
    presets.has(`${base}-high${speed}`) ||
    presets.has(`${base}-xhigh${speed}`) ||
    presets.has(`${base}-low`) ||
    presets.has(`${base}-high`) ||
    presets.has(`${base}-xhigh`)
  )
}

function effortToken(level: ThinkingLevel): string {
  if (level === 'medium') return ''
  return `-${level}`
}

/** Resolve effective CLI model from base selection + session thinking level. */
export function applyThinkingLevel(cliModel: string, level: ThinkingLevel): string {
  const effective = level === 'minimal' ? 'low' : level
  const { base, speedSuffix } = parseModelEffort(cliModel)
  const speed = speedSuffix === 'fast' ? '-fast' : ''
  const candidate = `${base}${effortToken(effective)}${speed}`
  const presets = cursorPresetIds()
  if (presets.has(candidate)) return candidate
  const withoutSpeed = `${base}${effortToken(effective)}`
  if (presets.has(withoutSpeed)) return withoutSpeed
  if (presets.has(base + speed)) return base + speed
  return cliModel
}

/** Infer thinking level from a stored cliModel id (for migration / preset pick). */
export function thinkingLevelFromModel(cliModel: string): ThinkingLevel {
  const { effortSuffix } = parseModelEffort(cliModel)
  if (effortSuffix === 'low' || effortSuffix === 'high' || effortSuffix === 'xhigh') {
    return effortSuffix
  }
  return 'medium'
}

/** Convert a preset/CLI id into the draft state stored by the Conductor composer. */
export function toConductorDraftSelection(cliModel: string): ConductorDraftSelection {
  const { base, speedSuffix } = parseModelEffort(cliModel)
  return {
    model: speedSuffix ? `${base}-fast` : base,
    thinkingLevel: thinkingLevelFromModel(cliModel),
  }
}

export function normalizeConductorDefaultThinkingLevel(v: unknown): ThinkingLevel | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined
  const level = v.trim() as ThinkingLevel
  return level === 'minimal' ||
    level === 'low' ||
    level === 'medium' ||
    level === 'high' ||
    level === 'xhigh'
    ? level
    : undefined
}

/** Resolve persisted defaults to a usable Conductor draft selection. */
export function resolveConductorDefaultSelection(
  provider: AgentProvider,
  configuredModel: string | null | undefined,
  configuredThinkingLevel?: string | null | undefined,
): ConductorDraftSelection {
  const model = normalizeConductorDefaultModel(configuredModel) || defaultConductorModel(provider)
  const draft = toConductorDraftSelection(model)
  const effort = normalizeConductorDefaultThinkingLevel(configuredThinkingLevel)
  return effort ? { ...draft, thinkingLevel: effort } : draft
}

/** Short display label: strip effort/speed words from preset label. */
export function displayModelName(label: string): string {
  return label
    .replace(/\s+(Low|High|Extra High|Medium)(\s+Fast)?$/i, '')
    .replace(/\s+Fast$/i, '')
    .trim()
}

export function isFastModel(cliModel: string): boolean {
  return parseModelEffort(cliModel).speedSuffix === 'fast'
}

/** True when two CLI ids refer to the same model family (ignoring effort/speed suffixes). */
export function sameModelFamily(a: string, b: string): boolean {
  return parseModelEffort(a).base === parseModelEffort(b).base
}
