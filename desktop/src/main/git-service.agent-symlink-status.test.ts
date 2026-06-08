import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFile } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { GitService } from './git-service'

const execFileAsync = promisify(execFile)

let workRoot: string

async function runGit(cwd: string, ...args: string[]) {
  await execFileAsync('git', args, { cwd })
}

async function commit(cwd: string, message: string) {
  await execFileAsync(
    'git',
    ['-c', 'user.email=a@b', '-c', 'user.name=Tester', 'commit', '-q', '-m', message],
    { cwd },
  )
}

describe('GitService.getStatus agent skill symlinks', () => {
  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'ca-agent-symlink-status-'))
  })

  afterEach(() => {
    rmSync(workRoot, { recursive: true, force: true })
  })

  it('omits gitignored agent skill symlinks but keeps visible ones', async () => {
    const repoPath = mkdtempSync(join(workRoot, 'repo-'))
    await runGit(repoPath, 'init', '-q', '-b', 'main')
    writeFileSync(join(repoPath, 'README.md'), '# test\n')
    writeFileSync(join(repoPath, '.gitignore'), '.codex/skills/ce-*\n')
    mkdirSync(join(repoPath, '.codex', 'skills'), { recursive: true })
    mkdirSync(join(repoPath, 'skill-target'), { recursive: true })
    writeFileSync(join(repoPath, 'skill-target', 'SKILL.md'), '# skill\n')
    symlinkSync(join(repoPath, 'skill-target'), join(repoPath, '.codex', 'skills', 'ce-hidden'))
    symlinkSync(join(repoPath, 'skill-target'), join(repoPath, '.codex', 'skills', 'hunk-review'))
    await runGit(repoPath, 'add', 'README.md', '.gitignore')
    await commit(repoPath, 'init')

    const statuses = await GitService.getStatus(repoPath)
    const paths = statuses.map((entry) => entry.path)

    expect(paths).not.toContain('.codex/skills/ce-hidden')
    expect(paths).toContain('.codex/skills/hunk-review')
  })
})
