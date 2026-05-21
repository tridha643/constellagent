import { isWriteToolName } from './tool-file-path'

const DELETE_TOOL = /^(?:delete|delete_file|remove_file)$/i

/** Verb-only label for Cursor-style mutate rows: Write | Edit | Delete. */
export function diffActionVerb(
  toolName: string,
  additions: number,
  deletions: number,
): 'Write' | 'Edit' | 'Delete' {
  if (DELETE_TOOL.test(toolName) || (additions === 0 && deletions > 0)) return 'Delete'
  if (isWriteToolName(toolName) || (deletions === 0 && additions > 0)) return 'Write'
  return 'Edit'
}

const COMPACT_LINE_LABEL = /^(?:write|edit|edited|wrote)\s+\d+\s+lines?$/i

/** Collapsed file-change row: prefer harness label when already compact (e.g. "Write 42 lines"). */
export function diffSummaryLabel(
  toolName: string,
  toolLabel: string,
  additions: number,
  deletions: number,
): string {
  const trimmed = toolLabel.trim()
  if (COMPACT_LINE_LABEL.test(trimmed)) return trimmed

  const total = additions + deletions
  if (total <= 0) {
    if (trimmed) return trimmed
    return isWriteToolName(toolName) ? 'Write' : 'Edit'
  }

  if (isWriteToolName(toolName) && deletions === 0) {
    return `Write ${additions} line${additions === 1 ? '' : 's'}`
  }

  return `Edit ${total} line${total === 1 ? '' : 's'}`
}
