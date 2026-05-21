import { useLayoutEffect, useMemo, useRef } from 'react'
import { normalizeMarkdownTables } from '../../../shared/normalize-markdown-tables'
import MarkdownStream, { type MarkdownStreamHandle } from '../../lib/prosemark/MarkdownStream'
import { useMarkdownSurfaceContext } from '../../hooks/useMarkdownSurfaceContext'
import styles from './MarkdownRenderer.module.css'

interface Props {
  children: string
  isStreaming?: boolean
  className?: string
  filePath?: string
  worktreePath?: string
}

/**
 * App-wide markdown renderer — ProseMark live preview with file chips, images,
 * and appearance-theme file icons. Used by plan preview, editor preview, Conductor, etc.
 */
export function MarkdownRenderer({ children, isStreaming, className, filePath, worktreePath }: Props) {
  const normalized = useMemo(() => normalizeMarkdownTables(children), [children])
  const { appearanceThemeId, worktreePath: resolvedWorktree, baseDir, openMarkdownFile } =
    useMarkdownSurfaceContext({ filePath, worktreePath })

  const streamRef = useRef<MarkdownStreamHandle | null>(null)
  const lastTextRef = useRef('')

  useLayoutEffect(() => {
    if (!isStreaming) return
    const handle = streamRef.current
    if (!handle) return
    const next = normalized
    const prev = lastTextRef.current
    if (next === prev) return
    if (next.startsWith(prev)) {
      handle.appendDelta(next.slice(prev.length))
    } else {
      handle.setContent(next)
    }
    lastTextRef.current = next
  }, [normalized, isStreaming])

  useLayoutEffect(() => {
    if (isStreaming) return
    lastTextRef.current = normalized
    streamRef.current?.refreshDecorations()
  }, [normalized, isStreaming])

  return (
    <div className={`${styles.wrapper} ${className ?? ''}`}>
      <MarkdownStream
        ref={streamRef}
        content={normalized}
        baseDir={baseDir}
        worktreePath={resolvedWorktree}
        appearanceThemeId={appearanceThemeId}
        onOpenMarkdownFile={openMarkdownFile}
      />
    </div>
  )
}
