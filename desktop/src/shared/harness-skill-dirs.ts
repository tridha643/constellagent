import { homedir } from 'os'
import { join } from 'path'

/** Workspace-relative skill roots scanned for every harness. */
export const HARNESS_SKILL_WORKSPACE_RELATIVE_DIRS = [
  '.codex/skills',
  '.cursor/skills',
  '.claude/skills',
  '.gemini/skills',
  '.opencode/skills',
] as const

/** Global skill roots under the user home directory. */
export const HARNESS_SKILL_GLOBAL_RELATIVE_DIRS = [
  '.agents/skills',
  '.codex/skills',
  '.cursor/skills',
  '.cursor/skills-cursor',
  '.claude/skills',
  '.gemini/skills',
  '.opencode/skills',
] as const

export type HarnessSkillTag =
  | 'agents'
  | 'codex'
  | 'cursor'
  | 'cursor-bundled'
  | 'claude'
  | 'gemini'
  | 'opencode'
  | 'catalog'
  | 'unknown'

export interface HarnessSkillScanDir {
  readonly path: string
  readonly scope: 'home' | 'workspace'
  readonly harness: HarnessSkillTag
}

const HARNESS_DIR_TAGS: Readonly<Record<string, HarnessSkillTag>> = {
  '.agents/skills': 'agents',
  '.codex/skills': 'codex',
  '.cursor/skills': 'cursor',
  '.cursor/skills-cursor': 'cursor-bundled',
  '.claude/skills': 'claude',
  '.gemini/skills': 'gemini',
  '.opencode/skills': 'opencode',
}

/** Ordered scan list: home dirs first, workspace dirs second (workspace wins on name collisions). */
export function resolveHarnessSkillScanDirs(workspacePath: string): readonly HarnessSkillScanDir[] {
  const home = homedir()
  const dirs: HarnessSkillScanDir[] = []

  for (const relative of HARNESS_SKILL_GLOBAL_RELATIVE_DIRS) {
    dirs.push({
      path: join(home, ...relative.split('/')),
      scope: 'home',
      harness: HARNESS_DIR_TAGS[relative] ?? 'unknown',
    })
  }

  for (const relative of HARNESS_SKILL_WORKSPACE_RELATIVE_DIRS) {
    dirs.push({
      path: join(workspacePath, ...relative.split('/')),
      scope: 'workspace',
      harness: HARNESS_DIR_TAGS[relative] ?? 'unknown',
    })
  }

  return dirs
}

function normalizeSkillPath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** Derive a harness tag from an absolute skill directory path. */
export function inferHarnessFromSkillPath(sourcePath: string): HarnessSkillTag {
  const norm = normalizeSkillPath(sourcePath)
  if (norm.includes('/.agents/skills/')) return 'agents'
  if (norm.includes('/.codex/skills/')) return 'codex'
  if (norm.includes('/.cursor/skills-cursor/')) return 'cursor-bundled'
  if (norm.includes('/.cursor/skills/')) return 'cursor'
  if (norm.includes('/.claude/skills/')) return 'claude'
  if (norm.includes('/.gemini/skills/')) return 'gemini'
  if (norm.includes('/.opencode/skills/')) return 'opencode'
  return 'unknown'
}

export function skillPathIsNativeForProvider(
  sourcePath: string,
  provider: 'codex' | 'cursor',
): boolean {
  const harness = inferHarnessFromSkillPath(sourcePath)
  if (provider === 'codex') return harness === 'codex'
  return harness === 'cursor' || harness === 'cursor-bundled'
}
