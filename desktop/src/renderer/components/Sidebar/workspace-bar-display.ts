import { normalizeWorkspaceBranch } from '../../store/workspace-branch'

const DEFAULT_BRANCH_FALLBACKS = new Set(['main', 'master', 'production'])

export function normalizeWorkspaceBarBranch(branch: string | null | undefined): string {
  return normalizeWorkspaceBranch(branch ?? '')
    .replace(/^refs\/remotes\/origin\//, '')
    .replace(/^remotes\/origin\//, '')
}

export function hasWorkspaceBarStats(
  additions: number | null | undefined,
  deletions: number | null | undefined,
): boolean {
  return (additions ?? 0) + (deletions ?? 0) > 0
}

export function shouldRenderWorkspaceBarStats(
  hasDiffSource: boolean,
  additions: number | null | undefined,
  deletions: number | null | undefined,
): boolean {
  return hasDiffSource && hasWorkspaceBarStats(additions, deletions)
}

export function isDefaultWorkspaceBarBranch(
  workspaceBranch: string | null | undefined,
  defaultBranch: string | null | undefined,
): boolean {
  const branch = normalizeWorkspaceBarBranch(workspaceBranch)
  if (!branch) return false

  const normalizedDefaultBranch = normalizeWorkspaceBarBranch(defaultBranch)
  if (normalizedDefaultBranch) {
    return branch === normalizedDefaultBranch
  }

  return DEFAULT_BRANCH_FALLBACKS.has(branch)
}

export function getWorkspaceBarLocalTitle({
  workspaceBranch,
  defaultBranch,
  displayName,
  subject,
}: {
  workspaceBranch: string | null | undefined
  defaultBranch: string | null | undefined
  displayName: string
  subject: string | null | undefined
}): string {
  if (isDefaultWorkspaceBarBranch(workspaceBranch, defaultBranch)) {
    return normalizeWorkspaceBarBranch(workspaceBranch) || displayName || 'main'
  }

  return subject || displayName
}
