export interface HunkCommentLike {
  id: string
  file: string
  newLine?: number
  oldLine?: number
  summary: string
}

/**
 * Format hunk session comments into a structured text block for agent consumption.
 * Submitted to the agent terminal via bracketed paste.
 */
export function formatReviewForAgent(comments: HunkCommentLike[]): string {
  if (comments.length === 0) return ''

  const lines: string[] = [
    '[Code Review Feedback]',
    'The following review comments were left on the current working tree diff:',
    '',
  ]

  for (const c of comments) {
    const line = c.newLine ?? c.oldLine ?? 0
    const side = c.newLine != null ? 'new' : 'old'
    lines.push(`## ${c.file} (line ${line}, ${side})`)
    lines.push(c.summary)
    lines.push('')
  }

  lines.push('Please address these review comments.')
  return lines.join('\n')
}
