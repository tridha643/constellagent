import type { LinearIssueNode } from '../../linear/linear-api'
import { workspaceBranchMatchesLinearIssue } from '../../linear/linear-api'
import type { Workspace } from '../../store/types'

/**
 * Prefer a workspace opened from this Linear issue (agent session);
 * otherwise a workspace name that starts with `<IDENTIFIER>:`;
 * otherwise a workspace whose branch matches the Linear issue identifier.
 */
export function findWorkspaceForLinearIssue(
  issue: LinearIssueNode,
  list: readonly Workspace[],
): Workspace | undefined {
  const linked = list.find((w) => w.linearIssueId === issue.id)
  if (linked) return linked
  const idPrefix = `${issue.identifier}:`.toLowerCase()
  const byName = list.find((w) => w.name.toLowerCase().startsWith(idPrefix))
  if (byName) return byName
  return list.find((w) => workspaceBranchMatchesLinearIssue(issue, w.branch))
}
