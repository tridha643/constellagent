export interface ReviewCommentLike {
  id: string
  file: string
  newLine?: number
  oldLine?: number
  summary: string
  author?: string
}

/**
 * Format review annotations into a structured text block for agent consumption.
 * Submitted to the agent terminal via bracketed paste.
 *
 * - Comments with a truthy `author` (AI-authored) are always excluded.
 * - When `selectedIds` is provided, only human comments whose id is in the set are included.
 */
export function formatReviewForAgent(
  comments: ReviewCommentLike[],
  selectedIds?: Set<string>,
): string {
  const filtered = comments.filter((c) => {
    if (c.author) return false
    if (selectedIds) return selectedIds.has(c.id)
    return true
  })

  if (filtered.length === 0) return ''

  const lines: string[] = [
    '[Code Review Feedback]',
    'The following review comments were left on the current working tree diff:',
    '',
  ]

  for (const c of filtered) {
    const line = c.newLine ?? c.oldLine ?? 0
    const side = c.newLine != null ? 'new' : 'old'
    lines.push(`## ${c.file} (line ${line}, ${side})`)
    lines.push(c.summary)
    lines.push('')
  }

  lines.push('Please address these review comments.')
  return lines.join('\n')
}
