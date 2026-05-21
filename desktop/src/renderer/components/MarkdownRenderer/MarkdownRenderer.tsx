import { useCallback, useMemo, type ReactNode } from 'react'
import { Streamdown } from 'streamdown'
import { normalizeMarkdownTables } from '../../../shared/normalize-markdown-tables'
import { createCodePlugin } from '@streamdown/code'
import { mermaid } from '@streamdown/mermaid'
import { math } from '@streamdown/math'
import { cjk } from '@streamdown/cjk'
import { useAppStore } from '../../store/app-store'
import { getAppearanceMermaidThemeVariables } from '../../theme/appearance'
import { SharedFileIcon } from '../../utils/file-presentation'
import { isMarkdownDocumentPath } from '../../utils/markdown-path'
import {
  markdownBasename,
  markdownDirname,
  resolveMarkdownFileTarget,
  resolveMarkdownImageSrc,
  type MarkdownFileTarget,
} from '../../utils/markdown-file-links'
import styles from './MarkdownRenderer.module.css'

interface Props {
  children: string
  isStreaming?: boolean
  className?: string
  filePath?: string
  worktreePath?: string
}

function fileChipLabel(children: ReactNode, target: MarkdownFileTarget): string {
  const raw = typeof children === 'string'
    ? children
    : Array.isArray(children)
      ? children.filter((child) => typeof child === 'string').join('')
      : ''
  const trimmed = raw.trim()
  if (!trimmed || trimmed === target.href || trimmed === target.displayPath) return markdownBasename(target.displayPath)
  return trimmed
}

export function MarkdownRenderer({ children, isStreaming, className, filePath, worktreePath }: Props) {
  const normalized = useMemo(() => normalizeMarkdownTables(children), [children])
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const baseDir = useMemo(() => markdownDirname(filePath), [filePath])
  const openMarkdownFile = useCallback((target: MarkdownFileTarget) => {
    if (isMarkdownDocumentPath(target.absolutePath)) openMarkdownPreview(target.absolutePath)
    else openFileTab(target.absolutePath, target.lineNumber ? { initialPosition: { lineNumber: target.lineNumber, column: 1 } } : undefined)
  }, [openFileTab, openMarkdownPreview])
  const components = useMemo(() => ({
    a: ({ href, children: linkChildren }: { href?: string; children?: ReactNode }) => {
      const target = resolveMarkdownFileTarget(href, { baseDir, worktreePath })
      if (!target) {
        return <a href={href} rel="noreferrer" target="_blank">{linkChildren}</a>
      }
      return (
        <button
          type="button"
          className={styles.fileChip}
          title={target.displayPath}
          aria-label={`Open ${target.displayPath}`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openMarkdownFile(target)
          }}
        >
          <SharedFileIcon path={target.displayPath} appearanceThemeId={appearanceThemeId} className={styles.fileChipIcon} />
          <span className={styles.fileChipLabel}>{fileChipLabel(linkChildren, target)}</span>
        </button>
      )
    },
    img: ({ src, alt, ...rest }: { src?: string; alt?: string }) => (
      <img
        {...rest}
        src={resolveMarkdownImageSrc(src, { baseDir, worktreePath })}
        alt={alt ?? ''}
        loading="lazy"
        decoding="async"
      />
    ),
  }), [appearanceThemeId, baseDir, openMarkdownFile, worktreePath])
  const code = useMemo(() => createCodePlugin({
    themes: ['github-dark', 'github-dark'],
  }), [])
  const mermaidThemeVariables = useMemo(
    () => getAppearanceMermaidThemeVariables(appearanceThemeId),
    [appearanceThemeId],
  )

  return (
    <div className={`${styles.wrapper} ${className ?? ''}`}>
      <Streamdown
        shikiTheme={['github-dark', 'github-dark']}
        plugins={{ code, mermaid, math, cjk }}
        animated={isStreaming}
        isAnimating={isStreaming}
        mermaid={{
          config: {
            theme: 'dark',
            themeVariables: mermaidThemeVariables,
          },
        }}
        components={components}
        controls={{
          mermaid: { fullscreen: true, download: true, copy: true, panZoom: true },
          code: { copy: true, download: true },
          /* Table chrome (copy/download/fullscreen) is disabled — layout was unreliable in our shell */
          table: false,
        }}
      >
        {normalized}
      </Streamdown>
    </div>
  )
}
