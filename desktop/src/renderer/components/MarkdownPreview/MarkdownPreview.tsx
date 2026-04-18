import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAppStore } from '../../store/app-store'
import { MarkdownRenderer } from '../MarkdownRenderer/MarkdownRenderer'
import { AddToChatMarkdownSurface } from '../AddToChat/AddToChatMarkdownSurface'
import {
  isAgentPlanPath,
  pathsEqualOrAlias,
} from '../../../shared/agent-plan-path'
import { PlanAgentToolbar } from '../PlanAgentToolbar/PlanAgentToolbar'
import styles from './MarkdownPreview.module.css'

function stripYamlFrontmatterForPreview(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

interface Props {
  filePath: string
  worktreePath?: string
}

export function MarkdownPreview({ filePath, worktreePath }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [userHome, setUserHome] = useState<string | undefined>(undefined)
  const openFileTab = useAppStore((s) => s.openFileTab)
  const activeTabId = useAppStore((s) => s.activeTabId)

  useEffect(() => {
    void window.api.app.getHomeDir().then(setUserHome).catch(() => {})
  }, [])

  const isPlan = isAgentPlanPath(worktreePath ?? '', filePath, userHome)
  const renderedContent = useMemo(
    () => (isPlan && content !== null ? stripYamlFrontmatterForPreview(content) : content),
    [content, isPlan],
  )

  const loadContent = useCallback(async () => {
    try {
      const text = await window.api.fs.readFile(filePath)
      if (text === null) {
        setError('File not found')
        setContent(null)
      } else {
        setContent(text)
        setError(null)
      }
    } catch {
      setError('Failed to read file')
      setContent(null)
    }
  }, [filePath])

  useEffect(() => { void loadContent() }, [loadContent])

  useEffect(() => {
    const watchRoots: string[] = []
    if (worktreePath) watchRoots.push(worktreePath)
    if (isPlan && filePath) {
      const i = filePath.lastIndexOf('/')
      if (i > 0) watchRoots.push(filePath.slice(0, i))
    }
    const unique = [...new Set(watchRoots)]
    if (unique.length === 0) return
    for (const d of unique) void window.api.fs.watchDir(d)
    const cleanup = window.api.fs.onDirChanged((changedDir) => {
      if (!unique.some((w) => pathsEqualOrAlias(changedDir, w))) return
      void loadContent()
    })
    return () => {
      for (const d of unique) void window.api.fs.unwatchDir(d)
      cleanup()
    }
  }, [worktreePath, filePath, isPlan, loadContent])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!worktreePath || detail?.worktreePath !== worktreePath) return
      void loadContent()
    }
    window.addEventListener('git:files-changed', handler)
    return () => window.removeEventListener('git:files-changed', handler)
  }, [worktreePath, loadContent])

  const fileName = filePath.split('/').pop() || filePath
  const dirPath = filePath.split('/').slice(0, -1).join('/')

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span>{error}</span>
          <span className={styles.errorPath}>{filePath}</span>
        </div>
      </div>
    )
  }

  if (content === null) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading...</div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <span className={styles.breadcrumb}>
          <span className={styles.breadcrumbDir}>{dirPath}/</span>
          {fileName}
        </span>
        <div className={styles.toolbarActions}>
          <PlanAgentToolbar
            filePath={filePath}
            worktreePath={worktreePath}
            hostTabId={activeTabId}
          />
          <button
            type="button"
            className={styles.editButton}
            onClick={() => openFileTab(filePath)}
            title="Open in editor"
          >
            ✎ Edit
          </button>
        </div>
      </div>
      <div className={styles.scrollArea}>
        <AddToChatMarkdownSurface filePath={filePath} className={styles.content}>
          <MarkdownRenderer>{renderedContent ?? ''}</MarkdownRenderer>
        </AddToChatMarkdownSurface>
      </div>
    </div>
  )
}
