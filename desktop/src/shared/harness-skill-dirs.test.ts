import { describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'
import {
  inferHarnessFromSkillPath,
  resolveHarnessSkillScanDirs,
  skillPathIsNativeForProvider,
} from '../shared/harness-skill-dirs'

describe('harness-skill-dirs', () => {
  test('includes global and workspace harness roots', () => {
    const workspace = '/tmp/example-workspace'
    const dirs = resolveHarnessSkillScanDirs(workspace)
    const paths = dirs.map((entry) => entry.path)

    expect(paths).toContain(join(homedir(), '.agents', 'skills'))
    expect(paths).toContain(join(homedir(), '.cursor', 'skills-cursor'))
    expect(paths).toContain(join(workspace, '.codex', 'skills'))
    expect(paths).toContain(join(workspace, '.claude', 'skills'))

    const workspaceEntries = dirs.filter((entry) => entry.scope === 'workspace')
    const homeEntries = dirs.filter((entry) => entry.scope === 'home')
    expect(workspaceEntries.length).toBeGreaterThan(0)
    expect(homeEntries.length).toBeGreaterThan(workspaceEntries.length)
  })

  test('infers harness tags from source paths', () => {
    expect(inferHarnessFromSkillPath('/Users/me/.codex/skills/canvas')).toBe('codex')
    expect(inferHarnessFromSkillPath('/Users/me/.cursor/skills-cursor/sdk')).toBe('cursor-bundled')
    expect(inferHarnessFromSkillPath('/Users/me/.agents/skills/task-prep')).toBe('agents')
  })

  test('detects native provider paths', () => {
    expect(skillPathIsNativeForProvider('/Users/me/.codex/skills/foo', 'codex')).toBe(true)
    expect(skillPathIsNativeForProvider('/Users/me/.claude/skills/foo', 'codex')).toBe(false)
    expect(skillPathIsNativeForProvider('/Users/me/.cursor/skills/foo', 'cursor')).toBe(true)
    expect(skillPathIsNativeForProvider('/Users/me/.claude/skills/foo', 'cursor')).toBe(false)
  })
})
