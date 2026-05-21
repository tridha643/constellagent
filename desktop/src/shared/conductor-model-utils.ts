import { PLAN_MODEL_PRESETS } from './plan-build-command'
import type { ThinkingLevel } from './conductor-thinking'

const EFFORT_SUFFIXES = ['xhigh', 'high', 'medium', 'low'] as const

export interface ParsedModelEffort {
  readonly base: string
  readonly effortSuffix?: string
  readonly speedSuffix?: 'fast'
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

/** Whether this model family supports a Fast (-fast) variant in CLI presets. */
export function hasFastVariant(cliModel: string): boolean {
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

/** Whether this model family has low/high/xhigh variants in cursor presets. */
export function hasEffortVariants(cliModel: string): boolean {
  const { base, speedSuffix } = parseModelEffort(cliModel)
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
  const { base, speedSuffix } = parseModelEffort(cliModel)
  const speed = speedSuffix === 'fast' ? '-fast' : ''
  const candidate = `${base}${effortToken(level)}${speed}`
  const presets = cursorPresetIds()
  if (presets.has(candidate)) return candidate
  const withoutSpeed = `${base}${effortToken(level)}`
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
