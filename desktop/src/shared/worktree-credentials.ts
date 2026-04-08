export type WorktreeCredentialRuleKind = 'glob' | 'file' | 'directory'

export interface WorktreeCredentialRule {
  id: string
  label: string
  pattern: string
  kind: WorktreeCredentialRuleKind
  enabled: boolean
  builtIn?: boolean
}

const WORKTREE_CREDENTIAL_RULE_KINDS = new Set<WorktreeCredentialRuleKind>([
  'glob',
  'file',
  'directory',
])

const BUILTIN_WORKTREE_CREDENTIAL_RULES: readonly WorktreeCredentialRule[] = [
  { id: 'builtin-env-glob', label: '.env*', pattern: '.env*', kind: 'glob', enabled: true, builtIn: true },
  { id: 'builtin-npmrc-file', label: '.npmrc', pattern: '.npmrc', kind: 'file', enabled: true, builtIn: true },
  { id: 'builtin-credentials-json-file', label: 'credentials.json', pattern: 'credentials.json', kind: 'file', enabled: true, builtIn: true },
  { id: 'builtin-auth-json-file', label: 'auth.json', pattern: 'auth.json', kind: 'file', enabled: true, builtIn: true },
  { id: 'builtin-secrets-json-file', label: 'secrets.json', pattern: 'secrets.json', kind: 'file', enabled: true, builtIn: true },
  { id: 'builtin-mcp-json-file', label: 'mcp.json', pattern: 'mcp.json', kind: 'file', enabled: true, builtIn: true },
  { id: 'builtin-claude-dir', label: '.claude/', pattern: '.claude', kind: 'directory', enabled: true, builtIn: true },
  { id: 'builtin-cursor-dir', label: '.cursor/', pattern: '.cursor', kind: 'directory', enabled: true, builtIn: true },
  { id: 'builtin-codex-dir', label: '.codex/', pattern: '.codex', kind: 'directory', enabled: true, builtIn: true },
  { id: 'builtin-gemini-dir', label: '.gemini/', pattern: '.gemini', kind: 'directory', enabled: true, builtIn: true },
  { id: 'builtin-opencode-dir', label: '.opencode/', pattern: '.opencode', kind: 'directory', enabled: true, builtIn: true },
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function cloneRule(rule: WorktreeCredentialRule): WorktreeCredentialRule {
  return { ...rule }
}

function ruleKey(kind: WorktreeCredentialRuleKind, pattern: string): string {
  return `${kind}:${pattern}`
}

export function normalizeWorktreeCredentialPattern(pattern: string): string {
  return pattern
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
}

function normalizeRule(rule: unknown): WorktreeCredentialRule | null {
  if (!isRecord(rule)) return null

  const id = typeof rule.id === 'string' ? rule.id.trim() : ''
  const label = typeof rule.label === 'string' ? rule.label.trim() : ''
  const pattern = typeof rule.pattern === 'string' ? normalizeWorktreeCredentialPattern(rule.pattern) : ''
  const kind =
    typeof rule.kind === 'string' && WORKTREE_CREDENTIAL_RULE_KINDS.has(rule.kind as WorktreeCredentialRuleKind)
      ? rule.kind as WorktreeCredentialRuleKind
      : null
  if (!id || !pattern || !kind) return null

  return {
    id,
    label: label || pattern,
    pattern,
    kind,
    enabled: rule.enabled !== false,
    builtIn: rule.builtIn === true,
  }
}

export function getDefaultWorktreeCredentialRules(): WorktreeCredentialRule[] {
  return BUILTIN_WORKTREE_CREDENTIAL_RULES.map(cloneRule)
}

export function normalizeWorktreeCredentialRules(rules: unknown): WorktreeCredentialRule[] {
  const defaults = getDefaultWorktreeCredentialRules()
  if (!Array.isArray(rules)) return defaults

  const defaultById = new Map(defaults.map((rule) => [rule.id, rule]))
  const defaultByKey = new Map(defaults.map((rule) => [ruleKey(rule.kind, rule.pattern), rule]))
  const builtInOverrides = new Map<string, WorktreeCredentialRule>()
  const customRules: WorktreeCredentialRule[] = []
  const seenCustomKeys = new Set<string>()

  for (const candidate of rules) {
    const normalized = normalizeRule(candidate)
    if (!normalized) continue

    const builtIn =
      defaultById.get(normalized.id)
      ?? defaultByKey.get(ruleKey(normalized.kind, normalized.pattern))
    if (builtIn || normalized.builtIn) {
      const builtInId = builtIn?.id ?? normalized.id
      if (!builtInOverrides.has(builtInId)) {
        builtInOverrides.set(builtInId, {
          ...normalized,
          id: builtInId,
          builtIn: true,
        })
      }
      continue
    }

    const customKey = ruleKey(normalized.kind, normalized.pattern)
    if (seenCustomKeys.has(customKey)) continue
    seenCustomKeys.add(customKey)
    customRules.push({ ...normalized, builtIn: false })
  }

  const mergedBuiltIns = defaults.map((defaultRule) => {
    const override = builtInOverrides.get(defaultRule.id)
    return override ? { ...defaultRule, enabled: override.enabled } : defaultRule
  })

  return [...mergedBuiltIns, ...customRules]
}
