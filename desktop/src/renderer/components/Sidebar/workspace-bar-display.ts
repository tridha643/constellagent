import { normalizeWorkspaceBranch } from '../../store/workspace-branch'

const DEFAULT_BRANCH_FALLBACKS = new Set(['main', 'master', 'production'])

export function normalizeWorkspaceBarBranch(branch: string | null | undefined): string {
  return normalizeWorkspaceBranch(branch ?? '')
    .replace(/^refs\/remotes\/origin\//, '')
    .replace(/^remotes\/origin\//, '')
}

export function shouldRenderWorkspaceBarStatValue(value: number | null | undefined): boolean {
  return (value ?? 0) > 0
}

export function hasWorkspaceBarStats(
  additions: number | null | undefined,
  deletions: number | null | undefined,
): boolean {
  return shouldRenderWorkspaceBarStatValue(additions) || shouldRenderWorkspaceBarStatValue(deletions)
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

/** True when the workspace has no commit subject worth a second mainline row. */
export function shouldUseCompactWorkspaceBarLocalFace({
  displayName,
  subject,
  workspaceBranch,
  defaultBranch,
}: {
  displayName: string
  subject: string | null | undefined
  workspaceBranch: string | null | undefined
  defaultBranch: string | null | undefined
}): boolean {
  const trimmedSubject = subject?.trim() ?? ''
  if (!trimmedSubject) return true

  const localTitle = getWorkspaceBarLocalTitle({
    workspaceBranch,
    defaultBranch,
    displayName,
    subject: trimmedSubject,
  })
  const ident = normalizeWorkspaceBarBranch(workspaceBranch) || displayName
  return localTitle === ident || localTitle === displayName
}

/** Show branch as a secondary line when the workspace has a custom display name. */
export function shouldShowWorkspaceBranchMeta({
  workspaceName,
  workspaceBranch,
}: {
  workspaceName: string
  workspaceBranch: string
}): boolean {
  const isAutoName = /^ws-[a-z0-9]+$/.test(workspaceName)
  return !isAutoName && !!workspaceBranch && workspaceBranch !== workspaceName
}
