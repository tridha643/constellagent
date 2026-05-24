import { useCallback, useState } from 'react'
import { useAppStore } from '../../../store/app-store'
import { SharedFileIcon } from '../../../utils/file-presentation'
import { isMarkdownDocumentPath } from '../../../utils/markdown-path'
import { parseFilePathListText } from '../../../../shared/file-path-list-text'
import { resolveToolFileAbsolutePath } from './tools/tool-file-path'
import styles from '../Conductor.module.css'

function CopyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" stroke="currentColor" strokeWidth="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function FilePathListPanel({
  paths,
  className,
}: {
  paths: string[]
  className?: string
}) {
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const worktreePath = useAppStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    return ws?.worktreePath ?? null
  })
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const [copied, setCopied] = useState(false)

  const copyAll = useCallback(async () => {
    const text = paths.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard may be unavailable */
    }
  }, [paths])

  const openPath = useCallback(
    (path: string) => {
      if (!worktreePath) return
      const absolute = resolveToolFileAbsolutePath(worktreePath, path)
      if (isMarkdownDocumentPath(absolute)) openMarkdownPreview(absolute)
      else openFileTab(absolute)
    },
    [worktreePath, openFileTab, openMarkdownPreview],
  )

  return (
    <div className={[styles.jsonCanvasFilePathList, className].filter(Boolean).join(' ')} data-testid="file-path-list">
      <div className={styles.jsonCanvasFilePathListHeader}>
        <span className={styles.jsonCanvasFilePathListCount}>
          {paths.length} {paths.length === 1 ? 'file' : 'files'}
        </span>
        <button
          type="button"
          className={styles.jsonCanvasFilePathListCopy}
          aria-label={copied ? 'Copied file paths' : 'Copy all file paths'}
          title={copied ? 'Copied' : 'Copy all paths'}
          onClick={() => void copyAll()}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <ul className={styles.jsonCanvasFilePathListRows}>
        {paths.map((path) => (
          <li key={path}>
            <button
              type="button"
              className={styles.jsonCanvasFilePathListRow}
              title={path}
              aria-label={`Open ${path}`}
              onClick={(event) => {
                event.stopPropagation()
                openPath(path)
              }}
            >
              <SharedFileIcon path={path} appearanceThemeId={appearanceThemeId} className={styles.jsonCanvasFilePathListIcon} />
              <span className={styles.jsonCanvasFilePathListPath}>{path}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Upgrade plain newline-separated path text to a rich file list when possible. */
export function FilePathListFromText({ text }: { text: string }) {
  const paths = parseFilePathListText(text)
  if (!paths) return null
  return <FilePathListPanel paths={paths} />
}
