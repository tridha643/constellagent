import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { HarnessSkillScanDir } from '../shared/harness-skill-dirs'
import { SkillsService } from './skills-service'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

function writeSkill(baseDir: string, folder: string, name: string, body = 'Skill body'): string {
  const skillDir = join(baseDir, folder)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`,
    'utf-8',
  )
  return skillDir
}

function scanDir(path: string, scope: HarnessSkillScanDir['scope'], harness: HarnessSkillScanDir['harness']): HarnessSkillScanDir {
  return { path, scope, harness }
}

describe('SkillsService.discoverSkillsFromScanDirs', () => {
  test('finds skills from multiple harness directories', async () => {
    const root = makeTempRoot('skills-ws-')
    writeSkill(root, '.codex/skills/codex-skill', 'codex-skill')
    writeSkill(root, '.cursor/skills/cursor-skill', 'cursor-skill')
    writeSkill(root, '.claude/skills/claude-skill', 'claude-skill')
    writeSkill(root, '.gemini/skills/gemini-skill', 'gemini-skill')

    const skills = await SkillsService.discoverSkillsFromScanDirs([
      scanDir(join(root, '.codex/skills'), 'workspace', 'codex'),
      scanDir(join(root, '.cursor/skills'), 'workspace', 'cursor'),
      scanDir(join(root, '.claude/skills'), 'workspace', 'claude'),
      scanDir(join(root, '.gemini/skills'), 'workspace', 'gemini'),
    ])
    const names = skills.map((skill) => skill.name).sort()

    expect(names).toEqual(['claude-skill', 'codex-skill', 'cursor-skill', 'gemini-skill'])
  })

  test('workspace scan order overrides earlier home entries with the same name', async () => {
    const root = makeTempRoot('skills-ws2-')
    const homeDir = join(root, 'home/.codex/skills')
    const workspaceDir = join(root, 'workspace/.codex/skills')
    writeSkill(root, 'home/.codex/skills/shared-skill', 'shared-skill', 'home body')
    const workspacePath = writeSkill(root, 'workspace/.codex/skills/shared-skill', 'shared-skill', 'workspace body')

    const skills = await SkillsService.discoverSkillsFromScanDirs([
      scanDir(homeDir, 'home', 'codex'),
      scanDir(workspaceDir, 'workspace', 'codex'),
    ])

    expect(skills).toHaveLength(1)
    expect(skills[0]?.sourcePath).toBe(workspacePath)
  })
})

describe('SkillsService.expandSkillInvocation', () => {
  test('inlines cross-harness skills for Codex', async () => {
    const workspace = makeTempRoot('skills-expand-')
    const skillName = 'constellagent-test-inline-skill'
    writeSkill(workspace, '.claude/skills/inline-skill', skillName, 'Prep ritual body')

    const result = await SkillsService.expandSkillInvocation(`/${skillName} prep this`, 'codex', workspace)

    expect(result.isSkillInvocation).toBe(true)
    expect(result.text).toContain(`Follow this skill (${skillName}):`)
    expect(result.text).toContain('Prep ritual body')
    expect(result.text).toContain('User request: prep this')
  })

  test('keeps native slash for in-harness Codex skills', async () => {
    const workspace = makeTempRoot('skills-native-codex-')
    const skillName = 'constellagent-test-codex-native'
    writeSkill(workspace, '.codex/skills/canvas-skill', skillName, 'Canvas instructions')

    const result = await SkillsService.expandSkillInvocation(`/${skillName} build chart`, 'codex', workspace)

    expect(result.isSkillInvocation).toBe(true)
    expect(result.text).toBe(`/${skillName} build chart`)
  })

  test('keeps native slash for in-harness Cursor skills', async () => {
    const workspace = makeTempRoot('skills-native-cursor-')
    const skillName = 'constellagent-test-cursor-native'
    writeSkill(workspace, '.cursor/skills/cursor-skill', skillName, 'SDK instructions')

    const result = await SkillsService.expandSkillInvocation(`/${skillName} integrate app`, 'cursor', workspace)

    expect(result.isSkillInvocation).toBe(true)
    expect(result.text).toBe(`/${skillName} integrate app`)
  })

  test('rewrites Pi invocations to /skill:name', async () => {
    const workspace = makeTempRoot('skills-pi-')
    const skillName = 'constellagent-test-pi-skill'
    writeSkill(workspace, '.claude/skills/my-skill', skillName, 'Pi skill body')

    const result = await SkillsService.expandSkillInvocation(`/${skillName} do work`, 'pi', workspace)

    expect(result.isSkillInvocation).toBe(true)
    expect(result.text).toBe(`/skill:${skillName} do work`)
  })

  test('leaves unknown slash commands unchanged', async () => {
    const workspace = makeTempRoot('skills-unknown-')
    const result = await SkillsService.expandSkillInvocation('/not-a-skill', 'codex', workspace)

    expect(result.isSkillInvocation).toBe(false)
    expect(result.text).toBe('/not-a-skill')
  })

  test('leaves host slash commands unchanged', async () => {
    const workspace = makeTempRoot('skills-host-')
    const result = await SkillsService.expandSkillInvocation('/compact', 'codex', workspace)

    expect(result.isSkillInvocation).toBe(false)
    expect(result.text).toBe('/compact')
  })
})

describe('SkillsService.parseSkillSlash', () => {
  test('parses skill name and args', () => {
    expect(SkillsService.parseSkillSlash('/task-prep prep this')).toEqual({
      name: 'task-prep',
      args: 'prep this',
    })
  })

  test('returns null for host commands', () => {
    expect(SkillsService.parseSkillSlash('/compact')).toBeNull()
  })
})
