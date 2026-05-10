import { spawnSync } from 'child_process'
import { parseGithubUrl, type GithubRepoInfo } from '../shared/github-url'

const originCache = new Map<string, GithubRepoInfo | null>()

function parseOrigin(stdout: string): GithubRepoInfo | null {
  const url = stdout.trim()
  if (!url) return null
  const parsed = parseGithubUrl(url)
  return parsed ? { owner: parsed.owner, name: parsed.name } : null
}

/** Resolve `origin` remote to GitHub owner/name for a repo path (sync, short timeout). */
export function getGithubRepoForRepoPath(repoPath: string): GithubRepoInfo | null {
  if (!repoPath) return null
  const cached = originCache.get(repoPath)
  if (cached !== undefined) return cached

  const result = spawnSync('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], {
    encoding: 'utf8',
    timeout: 4000,
    windowsHide: true,
  })
  if (result.error || result.status !== 0 || !result.stdout) {
    originCache.set(repoPath, null)
    return null
  }
  const info = parseOrigin(result.stdout)
  originCache.set(repoPath, info)
  return info
}

export function invalidateOriginCacheForTests(): void {
  originCache.clear()
}
