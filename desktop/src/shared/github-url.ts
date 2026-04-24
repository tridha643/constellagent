export interface GithubRepoInfo {
  owner: string
  name: string
}

export interface ParsedGithubUrl extends GithubRepoInfo {
  /** Normalized URL passed to `git clone`. HTTPS for most forms; SSH preserved when user pasted SSH. */
  cloneUrl: string
  /** Filesystem-safe folder name derived from the repo name. */
  suggestedName: string
}

function sanitizeFolderName(name: string): string {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 80)
  return sanitized || 'repo'
}

function buildHttpsCloneUrl(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}.git`
}

/**
 * Parse a user-entered string into a GitHub repo spec.
 * Accepts:
 *   - https://github.com/owner/repo(.git)?(/.*)?
 *   - http://github.com/owner/repo(.git)?
 *   - ssh://git@github.com/owner/repo(.git)?
 *   - git@github.com:owner/repo(.git)?
 *   - github.com/owner/repo(.git)?
 *   - owner/repo shorthand
 * Returns null for anything else (including non-github hosts).
 */
export function parseGithubUrl(input: string): ParsedGithubUrl | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('ssh://')
  ) {
    try {
      const parsed = new URL(trimmed)
      if (parsed.hostname.toLowerCase() !== 'github.com') return null
      const parts = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '').split('/')
      if (parts.length < 2) return null
      const owner = parts[0]
      const rawName = parts[1].replace(/\.git$/i, '')
      if (!owner || !rawName) return null
      return {
        owner,
        name: rawName,
        cloneUrl: buildHttpsCloneUrl(owner, rawName),
        suggestedName: sanitizeFolderName(rawName),
      }
    } catch {
      return null
    }
  }

  const sshMatch = trimmed.match(/^[^@\s]+@github\.com:([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/i)
  if (sshMatch?.[1] && sshMatch?.[2]) {
    const owner = sshMatch[1]
    const name = sshMatch[2]
    return {
      owner,
      name,
      cloneUrl: trimmed.endsWith('.git') ? trimmed : `${trimmed}.git`,
      suggestedName: sanitizeFolderName(name),
    }
  }

  const plainMatch = trimmed.match(/^github\.com[:/]([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/i)
  if (plainMatch?.[1] && plainMatch?.[2]) {
    const owner = plainMatch[1]
    const name = plainMatch[2]
    return {
      owner,
      name,
      cloneUrl: buildHttpsCloneUrl(owner, name),
      suggestedName: sanitizeFolderName(name),
    }
  }

  const shorthand = trimmed.match(/^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?$/)
  if (shorthand?.[1] && shorthand?.[2]) {
    const owner = shorthand[1]
    const name = shorthand[2]
    return {
      owner,
      name,
      cloneUrl: buildHttpsCloneUrl(owner, name),
      suggestedName: sanitizeFolderName(name),
    }
  }

  return null
}
