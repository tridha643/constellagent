import { useLayoutEffect, useRef } from 'react'
import MarkdownStream, { type MarkdownStreamHandle } from '../../../lib/prosemark/MarkdownStream'

/**
 * Static ProseMark markdown surface for Conductor (messages, tool bodies, etc.).
 * Assistant streaming uses `MarkdownStream` directly with an imperative ref.
 */
export function MarkdownBody({
  content,
  className,
  compact,
  inline: inlineMode,
}: {
  content: string
  className?: string
  /** Slightly smaller type for tool / subagent disclosure panels. */
  compact?: boolean
  /** Single-line chips (tool rows, activity ticker). */
  inline?: boolean
}) {
  const ref = useRef<MarkdownStreamHandle | null>(null)

  useLayoutEffect(() => {
    ref.current?.refreshDecorations()
  }, [content])

  if (!content.trim()) return null

  return (
    <MarkdownStream
      ref={ref}
      content={content}
      className={className}
      compact={compact}
      inline={inlineMode}
    />
  )
}

export function fencedCodeBlock(language: string, body: string): string {
  const lang = language.trim()
  return `\`\`\`${lang}\n${body}\n\`\`\``
}

/** One-line tool summary with optional path as inline code. */
export function inlineToolMarkdown(label: string, path?: string): string {
  const file = path?.trim()
  if (!file) return label
  const base = file.replace(/\\/g, '/').split('/').pop() || file
  return `${label} \`${base}\``
}

export function bashSummaryMarkdown(description: string | undefined, command: string): string {
  const parts: string[] = []
  if (description?.trim()) parts.push(`*${description.trim()}*`)
  parts.push(`\`$ ${command || 'Shell'}\``)
  return parts.join('\n\n')
}

export function diffPatchMarkdown(patch: string, hasNoNewline?: boolean): string {
  const body = patch.trim() || '_No textual changes._'
  const blocks = [fencedCodeBlock('diff', body)]
  if (hasNoNewline) blocks.push('_No newline at end of file_')
  return blocks.join('\n\n')
}

/** Prefer markdown prose for string detail; fence structured JSON for code rendering. */
export function toolOutputAsMarkdown(tool: {
  detail?: string
  output?: unknown
}, fallback: string): string {
  if (tool.detail?.trim()) return tool.detail
  if (typeof tool.output === 'string') return tool.output
  if (fallback.trim()) return `\`\`\`json\n${fallback}\n\`\`\``
  return ''
}
