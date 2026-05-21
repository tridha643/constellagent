import { useCallback } from 'react'
import { useAppStore } from '../store/app-store'
import { markdownDirname } from '../utils/markdown-file-links'
import type { MarkdownFileTarget } from '../utils/markdown-file-links'
import { isMarkdownDocumentPath } from '../utils/markdown-path'
import type { AppearanceThemeId } from '../theme/appearance'

export interface MarkdownSurfaceContextOptions {
  /** Directory for resolving relative markdown links (usually the source file's folder). */
  filePath?: string
  baseDir?: string
  /** Override active workspace root for repo-relative links. */
  worktreePath?: string
}

export interface MarkdownSurfaceContext {
  appearanceThemeId: AppearanceThemeId
  worktreePath: string | undefined
  baseDir: string | undefined
  openMarkdownFile: (target: MarkdownFileTarget) => void
}

/** Shared store wiring for every ProseMark markdown surface (Conductor, plans, editor preview). */
export function useMarkdownSurfaceContext(options: MarkdownSurfaceContextOptions = {}): MarkdownSurfaceContext {
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const activeWorktreePath = useAppStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    return ws?.worktreePath ?? undefined
  })
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)

  const baseDir = options.baseDir ?? markdownDirname(options.filePath)
  const worktreePath = options.worktreePath ?? activeWorktreePath

  const openMarkdownFile = useCallback((target: MarkdownFileTarget) => {
    if (isMarkdownDocumentPath(target.absolutePath)) openMarkdownPreview(target.absolutePath)
    else openFileTab(target.absolutePath, target.lineNumber ? { initialPosition: { lineNumber: target.lineNumber, column: 1 } } : undefined)
  }, [openFileTab, openMarkdownPreview])

  return { appearanceThemeId, worktreePath, baseDir, openMarkdownFile }
}
