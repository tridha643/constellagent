import { FileTree as TreesFileTree, useFileTree } from '@pierre/trees/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store/app-store'
import { useFileWatcher } from '../../hooks/useFileWatcher'
import { CONSTELLAGENT_PATH_MIME } from '../../utils/add-to-chat'
import { isMarkdownDocumentPath } from '../../utils/markdown-path'
import { SHARED_FILE_TREE_ICONS } from '../../utils/file-presentation'
import { buildFileTreeSnapshot, readExpandedDirectoryPaths, type FileNode, type FileTreeSnapshot } from './file-tree-adapter'
import { fileTreeActions } from './file-tree-actions'
import { ensureLetterBadgeSheet, findTreeShadowRoot } from './file-tree-shadow-css'
import styles from './RightPanel.module.css'

interface Props {
  worktreePath: string
  isActive?: boolean
}

const EMPTY_PATHS: string[] = []
const EMPTY_SNAPSHOT: FileTreeSnapshot = { paths: [], gitStatus: [] }

function toAbsolutePath(worktreePath: string, relativePath: string): string {
  const basePath = worktreePath.replace(/[\\/]+$/, '')
  const normalizedPath = relativePath.replace(/[\\/]+$/, '').replace(/^\//, '')
  return normalizedPath ? `${basePath}/${normalizedPath}` : basePath
}

function toRelativePath(worktreePath: string, filePath: string): string | null {
  const normalizedRoot = worktreePath.replace(/[\\/]+$/, '')
  if (filePath === normalizedRoot) return ''
  if (filePath.startsWith(`${normalizedRoot}/`)) return filePath.slice(normalizedRoot.length + 1)
  return null
}

function getTreeItemElement(event: Event): HTMLElement | null {
  for (const target of event.composedPath()) {
    if (target instanceof HTMLElement && target.dataset.itemPath) return target
  }
  return null
}

function clampMenuX(left: number) {
  return Math.max(8, Math.min(left, window.innerWidth - 220))
}

function clampMenuY(top: number) {
  return Math.max(8, Math.min(top, window.innerHeight - 220))
}

function FileTreeContextMenu({
  item,
  left,
  top,
  onOpenEditor,
  onOpenPreview,
  onOpenSplit,
  onDelete,
}: {
  item: { kind: 'file' | 'directory'; path: string }
  left: number
  top: number
  onOpenEditor: () => void
  onOpenPreview: () => void
  onOpenSplit: () => void
  onDelete: () => void
}) {
  const isMarkdown = item.kind === 'file' && isMarkdownDocumentPath(item.path)

  return (
    <div
      className={styles.fileContextMenu}
      data-file-tree-context-menu-root="true"
      style={{ left, top }}
    >
      {item.kind === 'file' && isMarkdown && (
        <>
          <button type="button" className={styles.fileContextMenuItem} onClick={onOpenPreview}>
            <span>Open preview</span>
          </button>
          <button type="button" className={styles.fileContextMenuItem} onClick={onOpenEditor}>
            <span>Open in editor</span>
          </button>
        </>
      )}

      {item.kind === 'file' && (
        <button type="button" className={styles.fileContextMenuItem} onClick={onOpenSplit}>
          <span>Open in Split Pane</span>
        </button>
      )}

      {item.kind === 'file' && !isMarkdown && (
        <button type="button" className={styles.fileContextMenuItem} onClick={onOpenEditor}>
          <span>Open in New Tab</span>
        </button>
      )}

      {item.kind === 'file' && <div className={styles.fileContextMenuSeparator} />}

      <button
        type="button"
        className={`${styles.fileContextMenuItem} ${styles.fileContextMenuItemDanger}`}
        onClick={onDelete}
      >
        <span>Delete</span>
        <span className={styles.fileContextMenuShortcut}>⌘⌫</span>
      </button>
    </div>
  )
}

function FileTreeNamePrompt({
  kind,
  onSubmit,
  onCancel,
}: {
  kind: 'file' | 'folder'
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const title = kind === 'file' ? 'New file' : 'New folder'
  const confirmLabel = kind === 'file' ? 'Create file' : 'Create folder'

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [kind])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className={styles.namePromptOverlay} onClick={onCancel} data-testid="file-tree-name-prompt">
      <div
        className={styles.namePromptDialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="file-tree-name-prompt-title"
        aria-modal="true"
      >
        <div id="file-tree-name-prompt-title" className={styles.namePromptTitle}>
          {title}
        </div>
        <p className={styles.namePromptHint}>Path relative to the workspace root. Nested folders are created automatically.</p>
        <input
          ref={inputRef}
          className={styles.namePromptInput}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSubmit(value)
            }
          }}
          placeholder={kind === 'file' ? 'e.g. notes.txt or src/lib.ts' : 'e.g. src/components'}
          autoComplete="off"
        />
        <div className={styles.namePromptActions}>
          <button type="button" className={styles.namePromptCancel} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.namePromptConfirm} onClick={() => onSubmit(value)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function FileTree({ worktreePath, isActive }: Props) {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const openFileInSplit = useAppStore((s) => s.openFileInSplit)
  const showConfirmDialog = useAppStore((s) => s.showConfirmDialog)
  const dismissConfirmDialog = useAppStore((s) => s.dismissConfirmDialog)
  const addToast = useAppStore((s) => s.addToast)

  const requestIdRef = useRef(0)
  const expandedPathsRef = useRef<string[]>([])
  const treeContainerRef = useRef<HTMLDivElement | null>(null)
  const [snapshot, setSnapshot] = useState<FileTreeSnapshot>(EMPTY_SNAPSHOT)
  const [isLoaded, setIsLoaded] = useState(false)
  const [namePrompt, setNamePrompt] = useState<null | { kind: 'file' | 'folder' }>(null)
  /** Matches absolute paths on FileNode rows from main (realpath); may differ from `worktreePath` when symlinks/casing differ. */
  const [treeRoot, setTreeRoot] = useState(worktreePath)

  const { model } = useFileTree({
    dragAndDrop: {
      canDrag: (paths) => paths.length === 1 && !paths[0]?.endsWith('/'),
      canDrop: () => false,
    },
    icons: SHARED_FILE_TREE_ICONS,
    initialExpansion: 'closed',
    itemHeight: 26,
    paths: EMPTY_PATHS,
    stickyFolders: false,
  })

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const activeRelativePath = useMemo(() => {
    if (activeTab?.type !== 'file' && activeTab?.type !== 'markdownPreview') return null
    return toRelativePath(treeRoot, activeTab.filePath)
  }, [activeTab, treeRoot])

  const syncExpandedPaths = useCallback(() => {
    expandedPathsRef.current = readExpandedDirectoryPaths(model.getFileTreeContainer() ?? null)
  }, [model])

  const fetchTree = useCallback(async () => {
    syncExpandedPaths()
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    try {
      const { rootPath, tree: nodes } = await window.api.fs.getTreeWithStatus(worktreePath)
      if (requestId !== requestIdRef.current) return
      setTreeRoot(rootPath)
      setSnapshot(buildFileTreeSnapshot(rootPath, nodes as FileNode[]))
      setIsLoaded(true)
    } catch {
      if (requestId !== requestIdRef.current) return
      setTreeRoot(worktreePath)
      setSnapshot(EMPTY_SNAPSHOT)
      setIsLoaded(true)
    }
  }, [syncExpandedPaths, worktreePath])

  const handleDelete = useCallback((absolutePath: string, kind: 'file' | 'directory') => {
    const name = absolutePath.split('/').pop() || absolutePath
    showConfirmDialog({
      title: `Delete ${kind === 'directory' ? 'Folder' : 'File'}`,
      message: `Permanently delete "${name}"${kind === 'directory' ? ' and all its contents' : ''}? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
      tip: 'Tip: Hold ⇧ Shift while deleting to skip this dialog',
      onConfirm: () => {
        dismissConfirmDialog()
        window.api.fs.deleteFile(absolutePath).then(() => {
          void fetchTree()
        }).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Failed to delete'
          addToast({ id: crypto.randomUUID(), message, type: 'error' })
        })
      },
    })
  }, [addToast, dismissConfirmDialog, fetchTree, showConfirmDialog])

  const renderContextMenu = useCallback((item: { kind: 'file' | 'directory'; path: string }, context: { anchorRect: DOMRect | { left: number; bottom: number }; close: () => void }) => {
    const absolutePath = toAbsolutePath(treeRoot, item.path)
    const close = () => context.close()

    return (
      <FileTreeContextMenu
        item={{ kind: item.kind, path: absolutePath }}
        left={clampMenuX(context.anchorRect.left)}
        top={clampMenuY(context.anchorRect.bottom + 6)}
        onOpenEditor={() => {
          openFileTab(absolutePath)
          close()
        }}
        onOpenPreview={() => {
          openMarkdownPreview(absolutePath)
          close()
        }}
        onOpenSplit={() => {
          openFileInSplit(absolutePath)
          close()
        }}
        onDelete={() => {
          close()
          handleDelete(absolutePath, item.kind)
        }}
      />
    )
  }, [handleDelete, openFileInSplit, openFileTab, openMarkdownPreview, treeRoot])

  const createTreeItem = useCallback(
    async (kind: 'file' | 'folder', rawName: string) => {
      const name = rawName.trim()
      if (!name) return
      const label = kind === 'file' ? 'file' : 'folder'
      try {
        const targetPath =
          kind === 'file' ? toAbsolutePath(treeRoot, name) : `${toAbsolutePath(treeRoot, name)}/.gitkeep`
        await window.api.fs.writeFile(targetPath, '')
        await fetchTree()
        if (kind === 'file') openFileTab(toAbsolutePath(treeRoot, name))
      } catch (err) {
        const message = err instanceof Error ? err.message : `Failed to create ${label}`
        addToast({ id: crypto.randomUUID(), message, type: 'error' })
      }
    },
    [addToast, fetchTree, openFileTab, treeRoot],
  )

  useEffect(() => {
    setIsLoaded(false)
    setSnapshot(EMPTY_SNAPSHOT)
    setTreeRoot(worktreePath)
    setNamePrompt(null)
    expandedPathsRef.current = []
  }, [worktreePath])

  useEffect(() => {
    if (!isActive) return
    void fetchTree()
  }, [fetchTree, isActive])

  useFileWatcher(worktreePath, fetchTree, Boolean(isActive))

  useEffect(() => {
    if (!isActive) return
    const onGitFilesChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ worktreePath?: string }>).detail
      if (detail?.worktreePath === worktreePath) void fetchTree()
    }
    window.addEventListener('git:files-changed', onGitFilesChanged)
    return () => window.removeEventListener('git:files-changed', onGitFilesChanged)
  }, [fetchTree, isActive, worktreePath])

  useLayoutEffect(() => {
    try {
      model.resetPaths(snapshot.paths, {
        initialExpandedPaths: expandedPathsRef.current,
      })
      model.setGitStatus(snapshot.gitStatus)
      model.setIcons(SHARED_FILE_TREE_ICONS)
    } catch (err) {
      console.error('[FileTree] model sync failed:', err)
    }
  }, [model, snapshot.gitStatus, snapshot.paths])

  // Attach the M/A/D/R/U letter-badge stylesheet into pierre's shadow root.
  // Pierre may mount its shadow host asynchronously on first render, so we
  // both probe immediately and observe future DOM mutations until attached.
  useEffect(() => {
    if (!isLoaded) return
    const container = treeContainerRef.current
    if (!container) return

    const attach = () => {
      const root = findTreeShadowRoot(container)
      if (!root) return false
      ensureLetterBadgeSheet(root)
      return true
    }

    if (attach()) return

    const observer = new MutationObserver(() => {
      if (attach()) observer.disconnect()
    })
    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [isLoaded])

  // Wire header toolbar actions (collapse-all / new file / new folder / search)
  // without coupling SidePanelHost to pierre or the store.
  // Do not use window.prompt — Electron's renderer does not show native prompts; it returns null.
  useEffect(() => {
    return fileTreeActions.on((action) => {
      if (!isActive) return
      if (action === 'collapseAll') {
        try {
          expandedPathsRef.current = []
          model.resetPaths(snapshot.paths, { initialExpandedPaths: [] })
          model.setGitStatus(snapshot.gitStatus)
        } catch (err) {
          console.error('[FileTree] collapseAll failed:', err)
        }
        return
      }

      if (action === 'focusSearch') {
        useAppStore.getState().toggleQuickOpen()
        return
      }

      if (action === 'newFile' || action === 'newFolder') {
        setNamePrompt({ kind: action === 'newFile' ? 'file' : 'folder' })
      }
    })
  }, [isActive, model, snapshot.gitStatus, snapshot.paths])

  useEffect(() => {
    if (!activeRelativePath) return
    try {
      // Expand every ancestor directory so a deeply-nested file (opened via
      // quick-open / Cmd-P, a tab click, etc.) is actually visible in the tree
      // — otherwise focusPath targets a collapsed, unrendered row.
      // Directory paths in this tree carry a trailing slash; file paths do not.
      const segments = activeRelativePath.split('/')
      let didExpand = false
      for (let i = 1; i < segments.length; i++) {
        const ancestorPath = `${segments.slice(0, i).join('/')}/`
        const ancestor = model.getItem(ancestorPath)
        if (!ancestor || !ancestor.isDirectory()) continue
        if (!ancestor.isExpanded()) {
          ancestor.expand()
          didExpand = true
        }
      }

      const item = model.getItem(activeRelativePath)
      if (!item) return
      model.focusPath(activeRelativePath)
      item.select()

      // Persist the programmatic expansion so the next fs-watcher-driven
      // `resetPaths` doesn't collapse the freshly-opened path back down.
      if (didExpand) requestAnimationFrame(syncExpandedPaths)
    } catch (err) {
      console.error('[FileTree] focus selection failed:', err)
    }
  }, [activeRelativePath, model, snapshot.paths, syncExpandedPaths])

  const handleTreeClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement | null)?.closest?.('[data-file-tree-context-menu-root="true"]')) return

    const target = getTreeItemElement(event.nativeEvent)
    if (!target) return

    const relativePath = target.dataset.itemPath
    const itemType = target.dataset.itemType
    if (!relativePath || !itemType) return

    if (itemType === 'folder') {
      requestAnimationFrame(syncExpandedPaths)
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const absolutePath = toAbsolutePath(treeRoot, relativePath)
    const item = model.getItem(relativePath)
    item?.select()
    model.focusPath(relativePath)

    if (event.metaKey || event.ctrlKey) {
      openFileInSplit(absolutePath)
      return
    }

    if (isMarkdownDocumentPath(absolutePath)) {
      openMarkdownPreview(absolutePath)
      return
    }

    openFileTab(absolutePath)
  }, [model, openFileInSplit, openFileTab, openMarkdownPreview, syncExpandedPaths, treeRoot])

  const handleTreeDragStart = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const target = getTreeItemElement(event.nativeEvent)
    if (!target || target.dataset.itemType !== 'file') return

    const relativePath = target.dataset.itemPath
    if (!relativePath || !event.dataTransfer) return

    const absolutePath = toAbsolutePath(treeRoot, relativePath)
    event.dataTransfer.setData(CONSTELLAGENT_PATH_MIME, absolutePath)
    event.dataTransfer.setData('text/plain', absolutePath)
    event.dataTransfer.effectAllowed = 'copy'
  }, [treeRoot])

  return (
    <>
      {namePrompt && (
        <FileTreeNamePrompt
          kind={namePrompt.kind}
          onCancel={() => setNamePrompt(null)}
          onSubmit={(name) => {
            const k = namePrompt.kind
            setNamePrompt(null)
            if (!name.trim()) return
            void createTreeItem(k, name)
          }}
        />
      )}
      <div
        ref={treeContainerRef}
        className={styles.treeContainer}
        data-testid="file-tree-wrapper"
        onClickCapture={handleTreeClickCapture}
        onDragStart={handleTreeDragStart}
      >
        {!isLoaded ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyText}>Loading files...</span>
          </div>
        ) : (
          <TreesFileTree
            className={styles.treeHost}
            data-testid="file-tree"
            model={model}
            renderContextMenu={renderContextMenu}
            style={{ height: '100%' }}
          />
        )}
      </div>
    </>
  )
}
