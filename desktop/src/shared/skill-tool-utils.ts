/** Shared helpers for native SDK skill-load tool rows in Conductor. */

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
