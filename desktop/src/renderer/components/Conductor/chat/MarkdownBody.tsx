import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { normalizeMarkdownTables } from '../../../../shared/normalize-markdown-tables'
import MarkdownStream, { type MarkdownStreamHandle } from '../../../lib/prosemark/MarkdownStream'
import type { MarkdownFileTarget } from '../../../utils/markdown-file-links'
import { isMarkdownDocumentPath } from '../../../utils/markdown-path'
import { useAppStore } from '../../../store/app-store'

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
  const normalized = useMemo(() => normalizeMarkdownTables(content), [content])
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const worktreePath = useAppStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    return ws?.worktreePath ?? undefined
  })
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const openMarkdownFile = useCallback((target: MarkdownFileTarget) => {
    if (isMarkdownDocumentPath(target.absolutePath)) openMarkdownPreview(target.absolutePath)
    else openFileTab(target.absolutePath, target.lineNumber ? { initialPosition: { lineNumber: target.lineNumber, column: 1 } } : undefined)
  }, [openFileTab, openMarkdownPreview])

  useLayoutEffect(() => {
    ref.current?.refreshDecorations()
  }, [normalized])

  if (!normalized.trim()) return null

  return (
    <MarkdownStream
      ref={ref}
      content={normalized}
      className={className}
      compact={compact}
      inline={inlineMode}
      worktreePath={worktreePath}
      appearanceThemeId={appearanceThemeId}
      onOpenMarkdownFile={openMarkdownFile}
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
