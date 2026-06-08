import { afterEach, describe, expect, it } from 'bun:test'
import { execSync } from 'child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { GitService } from './git-service'

function createTempRepo(name: string): string {
  const repoPath = join('/tmp', `git-symlink-test-${name}-${Date.now()}`)
  mkdirSync(repoPath, { recursive: true })
  execSync('git init', { cwd: repoPath })
  execSync('git checkout -b main', { cwd: repoPath })
  execSync('git config user.email "test@test.com"', { cwd: repoPath })
  execSync('git config user.name "Test"', { cwd: repoPath })
  writeFileSync(join(repoPath, 'README.md'), '# test\n')
  execSync('git add .', { cwd: repoPath })
  execSync('git commit -m "init"', { cwd: repoPath })
  return repoPath
}

const repos: string[] = []

afterEach(() => {
  for (const repoPath of repos.splice(0)) {
    try {
      if (existsSync(repoPath)) rmSync(repoPath, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
})

describe('GitService.getStatus agent skill symlinks', () => {
  it('omits gitignored skill symlinks from untracked status', async () => {
    const repoPath = createTempRepo('ignored-skills')
    repos.push(repoPath)

    mkdirSync(join(repoPath, '.cursor', 'skills'), { recursive: true })
    writeFileSync(join(repoPath, '.gitignore'), '.cursor/skills/ce-*\n')
    symlinkSync('/tmp/skill-target', join(repoPath, '.cursor', 'skills', 'ce-demo-reel'))

    const statuses = await GitService.getStatus(repoPath)
    const paths = statuses.map((entry) => entry.path)

    expect(paths).not.toContain('.cursor/skills/ce-demo-reel')
  })

  it('still reports non-ignored skill symlinks as untracked', async () => {
    const repoPath = createTempRepo('visible-skills')
    repos.push(repoPath)

    mkdirSync(join(repoPath, '.codex', 'skills'), { recursive: true })
    mkdirSync(join(repoPath, 'skill-target'), { recursive: true })
    writeFileSync(join(repoPath, 'skill-target', 'SKILL.md'), '# skill\n')
    symlinkSync('../../skill-target', join(repoPath, '.codex', 'skills', 'hunk-review'))

    const statuses = await GitService.getStatus(repoPath)
    const entry = statuses.find((s) => s.path === '.codex/skills/hunk-review')

    expect(entry).toEqual({ path: '.codex/skills/hunk-review', status: 'untracked', staged: false })
  })
})
