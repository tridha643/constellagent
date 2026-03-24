import type { PlanAgent } from './agent-plan-path'

/** Ordered options for the plan preview “Build with” harness selector. */
export const BUILD_HARNESS_OPTIONS: { agent: PlanAgent; label: string }[] = [
  { agent: 'claude-code', label: 'Claude' },
  { agent: 'codex', label: 'Codex' },
  { agent: 'gemini', label: 'Gemini' },
  { agent: 'cursor', label: 'Cursor' },
]

export interface ModelPreset {
  label: string
  /** Canonical id passed to the CLI's --model flag (stored in plan frontmatter for presets). */
  cliModel: string
}

export const PLAN_MODEL_PRESETS: Record<PlanAgent, ModelPreset[]> = {
  // Claude Code: aliases + Claude API ids (see Anthropic models overview).
  'claude-code': [
    { label: 'Opus (latest alias)', cliModel: 'opus' },
    { label: 'Sonnet (latest alias)', cliModel: 'sonnet' },
    { label: 'Haiku (latest alias)', cliModel: 'haiku' },
    { label: 'Claude Opus 4.6', cliModel: 'claude-opus-4-6' },
    { label: 'Claude Sonnet 4.6', cliModel: 'claude-sonnet-4-6' },
    { label: 'Claude Haiku 4.5', cliModel: 'claude-haiku-4-5' },
    { label: 'Claude Haiku 4.5 (dated)', cliModel: 'claude-haiku-4-5-20251001' },
    { label: 'Claude Sonnet 4.5', cliModel: 'claude-sonnet-4-5' },
    { label: 'Claude Sonnet 4.5 (dated)', cliModel: 'claude-sonnet-4-5-20250929' },
    { label: 'Claude Opus 4.5', cliModel: 'claude-opus-4-5' },
    { label: 'Claude Opus 4.5 (dated)', cliModel: 'claude-opus-4-5-20251101' },
    { label: 'Claude Opus 4.1', cliModel: 'claude-opus-4-1' },
    { label: 'Claude Opus 4.1 (dated)', cliModel: 'claude-opus-4-1-20250805' },
    { label: 'Claude Sonnet 4', cliModel: 'claude-sonnet-4-20250514' },
    { label: 'Claude Sonnet 4 (alias)', cliModel: 'claude-sonnet-4-0' },
    { label: 'Claude Opus 4', cliModel: 'claude-opus-4-20250514' },
    { label: 'Claude Opus 4 (alias)', cliModel: 'claude-opus-4-0' },
    { label: 'Claude 3.7 Sonnet (latest)', cliModel: 'claude-3-7-sonnet-latest' },
    { label: 'Claude 3.5 Sonnet', cliModel: 'claude-3-5-sonnet-20241022' },
    { label: 'Claude 3.5 Haiku', cliModel: 'claude-3-5-haiku-20241022' },
    { label: 'Claude 3 Haiku (deprecated)', cliModel: 'claude-3-haiku-20240307' },
    { label: 'Claude 3 Opus', cliModel: 'claude-3-opus-20240229' },
  ],
  // Codex CLI: https://developers.openai.com/codex/models/ plus common API models Codex accepts.
  codex: [
    { label: 'GPT-5.4', cliModel: 'gpt-5.4' },
    { label: 'GPT-5.4 mini', cliModel: 'gpt-5.4-mini' },
    { label: 'GPT-5.3 Codex', cliModel: 'gpt-5.3-codex' },
    { label: 'GPT-5.3 Codex Spark', cliModel: 'gpt-5.3-codex-spark' },
    { label: 'GPT-5.2 Codex', cliModel: 'gpt-5.2-codex' },
    { label: 'GPT-5.2', cliModel: 'gpt-5.2' },
    { label: 'GPT-5.1 Codex Max', cliModel: 'gpt-5.1-codex-max' },
    { label: 'GPT-5.1', cliModel: 'gpt-5.1' },
    { label: 'GPT-5.1 Codex', cliModel: 'gpt-5.1-codex' },
    { label: 'GPT-5 Codex', cliModel: 'gpt-5-codex' },
    { label: 'GPT-5 Codex mini', cliModel: 'gpt-5-codex-mini' },
    { label: 'GPT-5', cliModel: 'gpt-5' },
    { label: 'o3', cliModel: 'o3' },
    { label: 'o4-mini', cliModel: 'o4-mini' },
    { label: 'o1', cliModel: 'o1' },
    { label: 'o1-mini', cliModel: 'o1-mini' },
  ],
  // Gemini CLI (-m): stable + preview ids from Gemini CLI config / Google AI model catalog.
  gemini: [
    { label: 'Gemini 3.1 Pro (preview)', cliModel: 'gemini-3.1-pro-preview' },
    { label: 'Gemini 3.1 Flash-Lite (preview)', cliModel: 'gemini-3.1-flash-lite-preview' },
    { label: 'Gemini 3 Pro (preview)', cliModel: 'gemini-3-pro-preview' },
    { label: 'Gemini 3 Flash (preview)', cliModel: 'gemini-3-flash-preview' },
    { label: 'Gemini 2.5 Pro', cliModel: 'gemini-2.5-pro' },
    { label: 'Gemini 2.5 Flash', cliModel: 'gemini-2.5-flash' },
    { label: 'Gemini 2.5 Flash-Lite', cliModel: 'gemini-2.5-flash-lite' },
    { label: 'Gemini 2.5 Flash (preview 09-2025)', cliModel: 'gemini-2.5-flash-preview-09-2025' },
    { label: 'Gemini 2.0 Flash', cliModel: 'gemini-2.0-flash' },
    { label: 'Gemini 2.0 Flash-Lite', cliModel: 'gemini-2.0-flash-lite' },
  ],
  // From `cursor-agent --list-models` (Cursor Agent CLI).
  cursor: [
    { label: 'Auto', cliModel: 'auto' },
    { label: 'Composer 2 Fast', cliModel: 'composer-2-fast' },
    { label: 'Composer 2', cliModel: 'composer-2' },
    { label: 'Composer 1.5', cliModel: 'composer-1.5' },
    { label: 'GPT-5.3 Codex Low', cliModel: 'gpt-5.3-codex-low' },
    { label: 'GPT-5.3 Codex Low Fast', cliModel: 'gpt-5.3-codex-low-fast' },
    { label: 'GPT-5.3 Codex', cliModel: 'gpt-5.3-codex' },
    { label: 'GPT-5.3 Codex Fast', cliModel: 'gpt-5.3-codex-fast' },
    { label: 'GPT-5.3 Codex High', cliModel: 'gpt-5.3-codex-high' },
    { label: 'GPT-5.3 Codex High Fast', cliModel: 'gpt-5.3-codex-high-fast' },
    { label: 'GPT-5.3 Codex Extra High', cliModel: 'gpt-5.3-codex-xhigh' },
    { label: 'GPT-5.3 Codex Extra High Fast', cliModel: 'gpt-5.3-codex-xhigh-fast' },
    { label: 'GPT-5.2', cliModel: 'gpt-5.2' },
    { label: 'GPT-5.3 Codex Spark Low', cliModel: 'gpt-5.3-codex-spark-preview-low' },
    { label: 'GPT-5.3 Codex Spark', cliModel: 'gpt-5.3-codex-spark-preview' },
    { label: 'GPT-5.3 Codex Spark High', cliModel: 'gpt-5.3-codex-spark-preview-high' },
    { label: 'GPT-5.3 Codex Spark Extra High', cliModel: 'gpt-5.3-codex-spark-preview-xhigh' },
    { label: 'GPT-5.2 Codex Low', cliModel: 'gpt-5.2-codex-low' },
    { label: 'GPT-5.2 Codex Low Fast', cliModel: 'gpt-5.2-codex-low-fast' },
    { label: 'GPT-5.2 Codex', cliModel: 'gpt-5.2-codex' },
    { label: 'GPT-5.2 Codex Fast', cliModel: 'gpt-5.2-codex-fast' },
    { label: 'GPT-5.2 Codex High', cliModel: 'gpt-5.2-codex-high' },
    { label: 'GPT-5.2 Codex High Fast', cliModel: 'gpt-5.2-codex-high-fast' },
    { label: 'GPT-5.2 Codex Extra High', cliModel: 'gpt-5.2-codex-xhigh' },
    { label: 'GPT-5.2 Codex Extra High Fast', cliModel: 'gpt-5.2-codex-xhigh-fast' },
    { label: 'GPT-5.1 Codex Max Low', cliModel: 'gpt-5.1-codex-max-low' },
    { label: 'GPT-5.1 Codex Max Low Fast', cliModel: 'gpt-5.1-codex-max-low-fast' },
    { label: 'GPT-5.1 Codex Max', cliModel: 'gpt-5.1-codex-max-medium' },
    { label: 'GPT-5.1 Codex Max Medium Fast', cliModel: 'gpt-5.1-codex-max-medium-fast' },
    { label: 'GPT-5.1 Codex Max High', cliModel: 'gpt-5.1-codex-max-high' },
    { label: 'GPT-5.1 Codex Max High Fast', cliModel: 'gpt-5.1-codex-max-high-fast' },
    { label: 'GPT-5.1 Codex Max Extra High', cliModel: 'gpt-5.1-codex-max-xhigh' },
    { label: 'GPT-5.1 Codex Max Extra High Fast', cliModel: 'gpt-5.1-codex-max-xhigh-fast' },
    { label: 'GPT-5.4 1M High', cliModel: 'gpt-5.4-high' },
    { label: 'GPT-5.4 High Fast', cliModel: 'gpt-5.4-high-fast' },
    { label: 'GPT-5.4 Extra High Fast', cliModel: 'gpt-5.4-xhigh-fast' },
    { label: 'Opus 4.6 1M Thinking (default)', cliModel: 'claude-4.6-opus-high-thinking' },
    { label: 'GPT-5.4 1M Low', cliModel: 'gpt-5.4-low' },
    { label: 'GPT-5.4 1M', cliModel: 'gpt-5.4-medium' },
    { label: 'GPT-5.4 Fast', cliModel: 'gpt-5.4-medium-fast' },
    { label: 'GPT-5.4 1M Extra High', cliModel: 'gpt-5.4-xhigh' },
    { label: 'Sonnet 4.6 1M (current)', cliModel: 'claude-4.6-sonnet-medium' },
    { label: 'Sonnet 4.6 1M Thinking', cliModel: 'claude-4.6-sonnet-medium-thinking' },
    { label: 'Opus 4.6 1M', cliModel: 'claude-4.6-opus-high' },
    { label: 'Opus 4.6 1M Max', cliModel: 'claude-4.6-opus-max' },
    { label: 'Opus 4.6 1M Max Thinking', cliModel: 'claude-4.6-opus-max-thinking' },
    { label: 'Opus 4.5', cliModel: 'claude-4.5-opus-high' },
    { label: 'Opus 4.5 Thinking', cliModel: 'claude-4.5-opus-high-thinking' },
    { label: 'GPT-5.2 Low', cliModel: 'gpt-5.2-low' },
    { label: 'GPT-5.2 Low Fast', cliModel: 'gpt-5.2-low-fast' },
    { label: 'GPT-5.2 Fast', cliModel: 'gpt-5.2-fast' },
    { label: 'GPT-5.2 High', cliModel: 'gpt-5.2-high' },
    { label: 'GPT-5.2 High Fast', cliModel: 'gpt-5.2-high-fast' },
    { label: 'GPT-5.2 Extra High', cliModel: 'gpt-5.2-xhigh' },
    { label: 'GPT-5.2 Extra High Fast', cliModel: 'gpt-5.2-xhigh-fast' },
    { label: 'Gemini 3.1 Pro', cliModel: 'gemini-3.1-pro' },
    { label: 'GPT-5.4 Mini None', cliModel: 'gpt-5.4-mini-none' },
    { label: 'GPT-5.4 Mini Low', cliModel: 'gpt-5.4-mini-low' },
    { label: 'GPT-5.4 Mini', cliModel: 'gpt-5.4-mini-medium' },
    { label: 'GPT-5.4 Mini High', cliModel: 'gpt-5.4-mini-high' },
    { label: 'GPT-5.4 Mini Extra High', cliModel: 'gpt-5.4-mini-xhigh' },
    { label: 'GPT-5.4 Nano None', cliModel: 'gpt-5.4-nano-none' },
    { label: 'GPT-5.4 Nano Low', cliModel: 'gpt-5.4-nano-low' },
    { label: 'GPT-5.4 Nano', cliModel: 'gpt-5.4-nano-medium' },
    { label: 'GPT-5.4 Nano High', cliModel: 'gpt-5.4-nano-high' },
    { label: 'GPT-5.4 Nano Extra High', cliModel: 'gpt-5.4-nano-xhigh' },
    { label: 'Grok 4.20', cliModel: 'grok-4-20' },
    { label: 'Grok 4.20 Thinking', cliModel: 'grok-4-20-thinking' },
    { label: 'Sonnet 4.5 1M', cliModel: 'claude-4.5-sonnet' },
    { label: 'Sonnet 4.5 1M Thinking', cliModel: 'claude-4.5-sonnet-thinking' },
    { label: 'GPT-5.1 Low', cliModel: 'gpt-5.1-low' },
    { label: 'GPT-5.1', cliModel: 'gpt-5.1' },
    { label: 'GPT-5.1 High', cliModel: 'gpt-5.1-high' },
    { label: 'Gemini 3 Pro', cliModel: 'gemini-3-pro' },
    { label: 'Gemini 3 Flash', cliModel: 'gemini-3-flash' },
    { label: 'GPT-5.1 Codex Mini Low', cliModel: 'gpt-5.1-codex-mini-low' },
    { label: 'GPT-5.1 Codex Mini', cliModel: 'gpt-5.1-codex-mini' },
    { label: 'GPT-5.1 Codex Mini High', cliModel: 'gpt-5.1-codex-mini-high' },
    { label: 'Sonnet 4', cliModel: 'claude-4-sonnet' },
    { label: 'Sonnet 4 1M', cliModel: 'claude-4-sonnet-1m' },
    { label: 'Sonnet 4 Thinking', cliModel: 'claude-4-sonnet-thinking' },
    { label: 'Sonnet 4 1M Thinking', cliModel: 'claude-4-sonnet-1m-thinking' },
    { label: 'GPT-5 Mini', cliModel: 'gpt-5-mini' },
    { label: 'Kimi K2.5', cliModel: 'kimi-k2.5' },
  ],
}

/** Plan frontmatter from older builds used these labels; map to current cliModel ids. */
const LEGACY_PLAN_MODEL: Partial<Record<PlanAgent, Record<string, string>>> = {
  'claude-code': {
    'Opus 4.6': 'opus',
    'Opus 4.5': 'claude-opus-4-20250514',
    'Sonnet 4': 'sonnet',
    'Sonnet 3.7': 'claude-3-7-sonnet-latest',
  },
}

function isStoredKnownOnAgent(agent: PlanAgent, stored: string): boolean {
  if (PLAN_MODEL_PRESETS[agent].some((p) => p.label === stored || p.cliModel === stored)) {
    return true
  }
  return !!(LEGACY_PLAN_MODEL[agent]?.[stored])
}

const AGENT_CLI: Record<PlanAgent, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  gemini: 'gemini',
  cursor: 'cursor-agent',
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

/** Find a preset by stored frontmatter value (friendly label, cliModel, or legacy label). */
export function findPlanModelPreset(agent: PlanAgent, stored: string): ModelPreset | undefined {
  const hit = PLAN_MODEL_PRESETS[agent].find(
    (p) => p.label === stored || p.cliModel === stored,
  )
  if (hit) return hit
  const leg = LEGACY_PLAN_MODEL[agent]?.[stored]
  if (!leg) return undefined
  return (
    PLAN_MODEL_PRESETS[agent].find((p) => p.cliModel === leg)
    ?? { label: stored, cliModel: leg }
  )
}

/** Canonical select / CLI value: preset id, or custom string unchanged. */
export function canonicalPlanModelValue(agent: PlanAgent, stored: string | null): string {
  if (!stored) return ''
  const preset = findPlanModelPreset(agent, stored)
  return preset ? preset.cliModel : stored
}

/** Resolve a stored preset label or cliModel to the CLI --model value for a given agent. */
export function resolveCliModel(agent: PlanAgent, stored: string): string {
  const preset = findPlanModelPreset(agent, stored)
  return preset ? preset.cliModel : stored
}

/** Harness used for Build: explicit YAML choice wins over the plan file’s folder. */
export function effectivePlanHarness(
  buildHarness: PlanAgent | null,
  folderAgent: PlanAgent | null,
): PlanAgent | null {
  return buildHarness ?? folderAgent
}

/**
 * True if `stored` matches a preset on another harness but not on `harness`.
 * Shared CLI ids (e.g. gpt-5.3-codex on both Codex and Cursor) are not treated as stale.
 */
export function isModelLabelFromOtherHarness(harness: PlanAgent, stored: string): boolean {
  if (findPlanModelPreset(harness, stored)) return false
  for (const agent of Object.keys(PLAN_MODEL_PRESETS) as PlanAgent[]) {
    if (agent === harness) continue
    if (isStoredKnownOnAgent(agent, stored)) return true
  }
  return false
}

/** PlanAgent values already match the AGENT_ORCH_AGENT_TYPE env convention. */
export function planAgentToPtyAgentType(agent: PlanAgent): string {
  return agent
}

export interface BuildCommandResult {
  command: string
}

/** Build the CLI command string for launching a plan in the given agent harness. */
export function buildPlanAgentCommand(
  agent: PlanAgent,
  worktreePath: string,
  planAbsPath: string,
  modelLabel: string | null,
): BuildCommandResult {
  const cli = AGENT_CLI[agent]

  const relPath = planAbsPath.startsWith(worktreePath + '/')
    ? planAbsPath.slice(worktreePath.length + 1)
    : planAbsPath

  const cliModel = modelLabel ? resolveCliModel(agent, modelLabel.trim()) : null
  const prompt = `Implement the plan in ${relPath}`

  const parts = [cli]
  if (cliModel) parts.push('--model', cliModel)
  parts.push(shellEscape(prompt))

  return { command: parts.join(' ') }
}
