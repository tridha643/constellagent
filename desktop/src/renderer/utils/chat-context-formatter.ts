import { getFenceTag } from './language-map'

export interface ChatSnippet {
  text: string
  filePath?: string
  startLine?: number
  endLine?: number
}

const MAX_CHARS = 10_000

/**
 * Format one or more snippets into markdown suitable for pasting into an agent chat.
 * Each snippet gets a `@file:lines` header and a fenced code block.
 */
export function formatChatContext(snippets: ChatSnippet[]): string {
  const parts: string[] = []
  let total = 0

  for (const s of snippets) {
    let text = s.text
    if (total + text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS - total) + '\n... (truncated)'
    }

    const lines: string[] = []

    // Header: @filepath:startLine-endLine
    if (s.filePath) {
      let header = `@${s.filePath}`
      if (s.startLine != null) {
        header += `:${s.startLine}`
        if (s.endLine != null && s.endLine !== s.startLine) {
          header += `-${s.endLine}`
        }
      }
      lines.push(header)
    }

    // Fenced code block
    const fence = s.filePath ? getFenceTag(s.filePath) : ''
    lines.push('```' + fence)
    lines.push(text)
    lines.push('```')

    parts.push(lines.join('\n'))
    total += text.length
    if (total >= MAX_CHARS) break
  }

  return parts.join('\n\n')
}
