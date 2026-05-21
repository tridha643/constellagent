import type { ReactNode } from 'react'
import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { inlineToolMarkdown, MarkdownBody } from '../MarkdownBody'
import styles from '../../Conductor.module.css'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function firstString(input: unknown, keys: string[]): string | undefined {
  if (typeof input === 'string') return input.trim() || undefined
  const record = asRecord(input)
  if (!record) return undefined
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function pathFromInput(input: unknown): string | undefined {
  return firstString(input, ['path', 'file_path', 'filePath', 'target_file', 'targetFile', 'relative_path'])
}

export function queryFromInput(input: unknown): string | undefined {
  return firstString(input, ['query', 'pattern', 'q', 'search', 'regex'])
}

/** Compact single-line tool row: icon + markdown label (optional path as inline code). */
export function InlineToolRow({
  icon,
  label,
  path,
}: {
  icon: ReactNode
  label: string
  path?: string
}) {
  return (
    <div className={styles.toolInline}>
      <span className={styles.toolInlineIcon} aria-hidden>
        {icon}
      </span>
      <MarkdownBody
        content={inlineToolMarkdown(label, path)}
        className={styles.toolInlineMarkdown}
        compact
        inline
      />
    </div>
  )
}

const ICON_STROKE = 1.6

function FolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={ICON_STROKE}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" strokeLinejoin="round" />
    </svg>
  )
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={ICON_STROKE}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}

function GlobeGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={ICON_STROKE}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </svg>
  )
}

export function ListTool({ tool }: { tool: TimelineToolCall }) {
  const path = pathFromInput(tool.input)
  const pattern = firstString(tool.input, ['pattern', 'glob', 'query'])
  return <InlineToolRow icon={<FolderGlyph />} label={pattern ? `Listed ${pattern}` : 'Listed files'} path={path} />
}

export function GrepTool({ tool }: { tool: TimelineToolCall }) {
  const query = queryFromInput(tool.input)
  return <InlineToolRow icon={<SearchGlyph />} label={query ? `Searched “${query}”` : 'Searched'} />
}

export function WebSearchTool({ tool }: { tool: TimelineToolCall }) {
  const query = queryFromInput(tool.input)
  return <InlineToolRow icon={<GlobeGlyph />} label={query ? `Searched the web for “${query}”` : 'Web search'} />
}
