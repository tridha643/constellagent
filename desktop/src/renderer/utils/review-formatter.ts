import type { DiffAnnotation } from '@shared/diff-annotation-types'
import { annotationLineEnd } from '../../shared/diff-annotation-types'

/**
 * Format unresolved annotations into a structured text block for agent consumption.
 * Submitted to the agent terminal via bracketed paste.
 */
export function formatReviewForAgent(annotations: DiffAnnotation[]): string {
  const unresolved = annotations.filter((a) => !a.resolved)
  if (unresolved.length === 0) return ''

  const lines: string[] = [
    '[Code Review Feedback]',
    'The following review comments were left on the current working tree diff:',
    '',
  ]

  for (const a of unresolved) {
    const end = annotationLineEnd(a)
    const range = end !== a.lineNumber ? `lines ${a.lineNumber}-${end}` : `line ${a.lineNumber}`
    lines.push(`## ${a.filePath} (${range}, ${a.side})`)
    lines.push(a.body)
    lines.push('')
  }

  lines.push('Please address these review comments.')
  return lines.join('\n')
}
