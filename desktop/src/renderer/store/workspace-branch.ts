export function normalizeWorkspaceBranch(branch: string): string {
  return branch.trim().replace(/^refs\/heads\//, '').replace(/^origin\//, '')
}

export function isDetachedHeadBranchLabel(branch: string): boolean {
  return normalizeWorkspaceBranch(branch).toUpperCase() === 'HEAD'
}

export function isStableWorkspaceBranch(branch: string): boolean {
  const normalized = normalizeWorkspaceBranch(branch)
  return normalized.length > 0 && !isDetachedHeadBranchLabel(normalized)
}

/**
 * Rebases/restacks with conflicts temporarily detach HEAD. Keep the last stable
 * branch label in renderer state so the workspace stays recognizable in the UI.
 */
export function preserveWorkspaceBranch(currentBranch: string, nextBranch: string): string {
  const normalizedNext = normalizeWorkspaceBranch(nextBranch)
  if (isStableWorkspaceBranch(normalizedNext)) {
    return normalizedNext
  }
  return normalizeWorkspaceBranch(currentBranch)
}
