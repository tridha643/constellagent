/** Shared helpers for native SDK skill-load tool rows in Conductor. */

import { isConductorHostSlashName } from './conductor-composer-commands'

const SKILL_IDENTIFIER_RE = /^[a-z][a-z0-9_-]*$/i

/** Inline \`composio-cli\`-style tokens in markdown (not file paths or shell snippets). */
export function isLikelySkillIdentifier(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length < 2 || trimmed.length > 64) return false
  if (/[\s/\\]/.test(trimmed) || trimmed.startsWith('$')) return false
  if (/\.[a-z0-9]{1,12}$/i.test(trimmed)) return false
  if (!SKILL_IDENTIFIER_RE.test(trimmed)) return false
  return !isConductorHostSlashName(trimmed)
}

export interface MarkdownSkillSlashReference {
  from: number
  to: number
  name: string
}

/** Bare `/skill-name` tokens in prose (mirrors pi-gui message-inline-segments). */
export function findMarkdownSkillSlashReferences(text: string): MarkdownSkillSlashReference[] {
  const re = /(?:^|[\s([{`'"])\/([a-z][a-z0-9_-]{0,63})(?=\s|$|[.,;:!?)}\]`'"])/g
  const out: MarkdownSkillSlashReference[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const name = match[1]
    if (!name || isConductorHostSlashName(name)) continue
    const from = match.index + match[0].indexOf('/')
    out.push({ from, to: from + name.length + 1, name })
  }
  return out
}

export function isSkillLoadToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase()
  if (normalized === 'skill' || normalized === 'load_skill' || normalized === 'skill_load') {
    return true
  }
  if (normalized.endsWith('.load_skill') || normalized.endsWith('.skill') || normalized.endsWith('.skill_load')) {
    return true
  }
  return /\bload[_-]?skill\b/.test(normalized)
}

export function skillDisplayFromToolInput(input: unknown): { label: string; skillId?: string } {
  if (typeof input === 'string' && input.trim()) {
    const skillId = input.trim()
    return { label: humanizeSkillId(skillId), skillId }
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Record<string, unknown>
    const skillId =
      (typeof record.skill === 'string' && record.skill.trim()) ||
      (typeof record.skill_name === 'string' && record.skill_name.trim()) ||
      (typeof record.skillName === 'string' && record.skillName.trim()) ||
      (typeof record.name === 'string' && record.name.trim()) ||
      undefined
    if (skillId) {
      return { label: humanizeSkillId(skillId.replace(/^skill:/i, '')), skillId }
    }
  }
  return { label: 'Skill' }
}

function humanizeSkillId(id: string): string {
  return id
    .split(/[-_/]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
