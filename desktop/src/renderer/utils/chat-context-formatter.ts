import type { ChatSnippet } from '../store/types'
import { getFenceTag } from './language-map'

const MAX_CONTEXT_CHARS = 10_000

export function formatChatContext(snippets: ChatSnippet[]): string {
  const parts: string[] = []

  for (const s of snippets) {
    if (s.browser) {
      parts.push(formatBrowserContext(s))
      continue
    }

    let header = ''
    if (s.filePath) {
      header = `@${s.filePath}`
      if (s.startLine != null) {
        header += `:${s.startLine}`
        if (s.endLine != null && s.endLine !== s.startLine) {
          header += `-${s.endLine}`
        }
      }
    }

    const fence = s.filePath ? getFenceTag(s.filePath) : ''
    const block = fence
      ? `\`\`\`${fence}\n${s.text}\n\`\`\``
      : s.text

    parts.push(header ? `${header}\n${block}` : block)
  }

  let result = parts.join('\n\n')

  if (result.length > MAX_CONTEXT_CHARS) {
    result = result.slice(0, MAX_CONTEXT_CHARS) + '\n\n[...truncated]'
  }

  return result
}

function formatBrowserContext(s: ChatSnippet): string {
  const b = s.browser!
  const lines: string[] = []
  if (b.source) {
    const tail = b.source.column != null ? `:${b.source.line}:${b.source.column}` : `:${b.source.line}`
    lines.push(`@${b.source.file}${tail}`)
  } else {
    lines.push('Captured from browser panel')
  }
  if (b.displayName) lines.push(`Component: <${b.displayName}>`)
  lines.push(`Tag: <${b.tagName.toLowerCase()}>`)
  if (b.classes.length > 0) lines.push(`Classes: ${b.classes.join(' ')}`)
  if (b.textPreview) lines.push(`Text: "${b.textPreview}"`)
  if (b.url) lines.push(`URL: ${b.url}`)
  if (s.text && s.text !== b.textPreview) lines.push(s.text)
  return lines.join('\n')
}
