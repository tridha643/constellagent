/**
 * Synthetic relative paths for Linear Cmd+F native fff indexing (user/project/issue hierarchy).
 */

import type { LinearIssueNode, LinearProjectNode } from './linear-api'

/** Max segment / leaf length to avoid path explosion on disk. */
const MAX_SEG = 80

/** Safe single path segment or filename token (posix-ish). */
export function sanitizeLinearPathSegment(raw: string, fallback: string): string {
  const t = raw
    .trim()
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  const out = t.slice(0, MAX_SEG)
  return out || fallback
}

/** Encode LinearJumpRow id for use in filenames (issue:uuid → issue_uuid). */
export function encodeLinearRowIdForFilename(rowId: string): string {
  return rowId.replace(/[^a-zA-Z0-9]/g, '_')
}

/**
 * Issue row: `user/project/<identifier>-<title>--<rowId>.txt`
 * user = assignee name or `_unassigned`
 * project = project name + short id disambiguator
 */
export function syntheticRelativePathForIssue(issue: LinearIssueNode, rowId: string): string {
  const user = sanitizeLinearPathSegment(issue.assignee?.name ?? '', '_unassigned')
  const projName = issue.project?.name ?? 'no-project'
  const projIdShort = issue.project?.id
    ? issue.project.id.replace(/-/g, '').slice(0, 12)
    : 'noproject'
  const project = sanitizeLinearPathSegment(`${projName}-p${projIdShort}`, 'no-project')
  const idPart = sanitizeLinearPathSegment(issue.identifier, 'issue')
  const titlePart = sanitizeLinearPathSegment(issue.title, 'title')
  const leaf = `${idPart}-${titlePart}--${encodeLinearRowIdForFilename(rowId)}.txt`
  return `${user}/${project}/${leaf}`
}

/**
 * Project row: `_org/<project>-p<id>/[<team key or name>/…]/[<org>]/project--<rowId>.txt`
 * Extra segments let FileFinder match team keys and org name on the path.
 */
export function syntheticRelativePathForProject(project: LinearProjectNode, rowId: string): string {
  const pid = project.id.replace(/-/g, '').slice(0, 12)
  const seg = sanitizeLinearPathSegment(`${project.name}-p${pid}`, 'project')
  const parts: string[] = ['_org', seg]
  const seen = new Set<string>()
  for (const t of project.teamSummaries ?? []) {
    const raw = (t.key ?? '').trim() || (t.name ?? '').trim()
    if (!raw) continue
    const te = sanitizeLinearPathSegment(raw, 't')
    if (!te || seen.has(te)) continue
    seen.add(te)
    parts.push(te)
  }
  const org = project.organizationName?.trim()
  if (org) {
    const oe = sanitizeLinearPathSegment(org, 'org')
    if (oe && !seen.has(oe)) parts.push(oe)
  }
  const leaf = `project--${encodeLinearRowIdForFilename(rowId)}.txt`
  return `${parts.join('/')}/${leaf}`
}

/** Bar row: `_bar/<project>/bar--<rowId>.txt` */
export function syntheticRelativePathForBar(params: {
  projectName: string
  rowId: string
}): string {
  const p = sanitizeLinearPathSegment(params.projectName, 'project')
  return `_bar/${p}/bar--${encodeLinearRowIdForFilename(params.rowId)}.txt`
}
