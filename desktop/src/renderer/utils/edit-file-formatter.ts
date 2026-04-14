import { getFenceTag } from './language-map'

const MAX_EDIT_FILE_CHARS = 12_000

interface EditFilePayloadInput {
  filePath: string
  text?: string
  startLine?: number
  endLine?: number
}

function truncateText(text: string): string {
  if (text.length <= MAX_EDIT_FILE_CHARS) return text
  return `${text.slice(0, MAX_EDIT_FILE_CHARS)}\n\n[...truncated]`
}

function formatRange(startLine?: number, endLine?: number): string {
  if (startLine == null) return ''
  if (endLine == null || endLine === startLine) return `:${startLine}`
  return `:${startLine}-${endLine}`
}

export function formatEditFilePayload({ filePath, text, startLine, endLine }: EditFilePayloadInput): string {
  const fence = getFenceTag(filePath)
  const header = `[edit_file]\n@${filePath}${formatRange(startLine, endLine)}`
  const trimmed = text?.trim()
  if (!trimmed) return header

  const body = truncateText(trimmed)
  if (!fence) {
    return `${header}\n\n\`\`\`\n${body}\n\`\`\``
  }

  return `${header}\n\n\`\`\`${fence}\n${body}\n\`\`\``
}
