import { useLayoutEffect, useMemo, useRef } from 'react'
import { normalizeMarkdownTables } from '../../../shared/normalize-markdown-tables'
import MarkdownStream, { type MarkdownStreamHandle } from '../../lib/prosemark/MarkdownStream'
import { useMarkdownSurfaceContext } from '../../hooks/useMarkdownSurfaceContext'

/**
 * Static ProseMark markdown surface — default preset for chat, plans, tool bodies, etc.
 * Streaming callers use `MarkdownStream` directly with an imperative ref.
 */
export function MarkdownBody({
  content,
  className,
  compact,
  inline: inlineMode,
  filePath,
  baseDir,
  worktreePath,
}: {
  content: string
  className?: string
  /** Slightly smaller type for tool / subagent disclosure panels. */
  compact?: boolean
  /** Single-line chips (tool rows, activity ticker). */
  inline?: boolean
  filePath?: string
  baseDir?: string
  worktreePath?: string
}) {
  const ref = useRef<MarkdownStreamHandle | null>(null)
  const normalized = useMemo(() => normalizeMarkdownTables(content), [content])
  const { appearanceThemeId, worktreePath: resolvedWorktree, baseDir: resolvedBaseDir, openMarkdownFile } =
    useMarkdownSurfaceContext({ filePath, baseDir, worktreePath })

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
      baseDir={resolvedBaseDir}
      worktreePath={resolvedWorktree}
      appearanceThemeId={appearanceThemeId}
      onOpenMarkdownFile={openMarkdownFile}
    />
  )
}
