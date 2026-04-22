import { preparePresortedFileTreeInput } from '@pierre/trees'
import { FileTree as TreesFileTree, useFileTree } from '@pierre/trees/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store/app-store'
import { useFileWatcher } from '../../hooks/useFileWatcher'
import { CONSTELLAGENT_PATH_MIME } from '../../utils/add-to-chat'
import { isMarkdownDocumentPath } from '../../utils/markdown-path'
import { SHARED_FILE_TREE_ICONS } from '../../utils/file-presentation'
import { buildFileTreeSnapshot, readExpandedDirectoryPaths, type FileNode, type FileTreeSnapshot } from './file-tree-adapter'
import styles from './RightPanel.module.css'

interface Props {
  worktreePath: string
  isActive?: boolean
}

const EMPTY_PATHS: string[] = []
const EMPTY_PREPARED_INPUT = preparePresortedFileTreeInput(EMPTY_PATHS)
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
  const [snapshot, setSnapshot] = useState<FileTreeSnapshot>(EMPTY_SNAPSHOT)
  const [isLoaded, setIsLoaded] = useState(false)

  const { model } = useFileTree({
    dragAndDrop: {
      canDrag: (paths) => paths.length === 1 && !paths[0]?.endsWith('/'),
      canDrop: () => false,
    },
    icons: SHARED_FILE_TREE_ICONS,
    initialExpansion: 'closed',
    itemHeight: 26,
    paths: EMPTY_PATHS,
    preparedInput: EMPTY_PREPARED_INPUT,
    stickyFolders: false,
  })

  const preparedInput = useMemo(
    () => preparePresortedFileTreeInput(snapshot.paths),
    [snapshot.paths],
  )

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const activeRelativePath = useMemo(() => {
    if (activeTab?.type !== 'file' && activeTab?.type !== 'markdownPreview') return null
    return toRelativePath(worktreePath, activeTab.filePath)
  }, [activeTab, worktreePath])

  const syncExpandedPaths = useCallback(() => {
    expandedPathsRef.current = readExpandedDirectoryPaths(model.getFileTreeContainer() ?? null)
  }, [model])

  const fetchTree = useCallback(async () => {
    syncExpandedPaths()
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    try {
      const nodes = await window.api.fs.getTreeWithStatus(worktreePath) as FileNode[]
      if (requestId !== requestIdRef.current) return
      setSnapshot(buildFileTreeSnapshot(worktreePath, nodes))
      setIsLoaded(true)
    } catch {
      if (requestId !== requestIdRef.current) return
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
    const absolutePath = toAbsolutePath(worktreePath, item.path)
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
  }, [handleDelete, openFileInSplit, openFileTab, openMarkdownPreview, worktreePath])

  useEffect(() => {
    setIsLoaded(false)
    setSnapshot(EMPTY_SNAPSHOT)
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

  useEffect(() => {
    model.resetPaths(snapshot.paths, {
      initialExpandedPaths: expandedPathsRef.current,
      preparedInput,
    })
    model.setGitStatus(snapshot.gitStatus)
    model.setIcons(SHARED_FILE_TREE_ICONS)
  }, [model, preparedInput, snapshot.gitStatus, snapshot.paths])

  useEffect(() => {
    if (!activeRelativePath) return
    const item = model.getItem(activeRelativePath)
    if (!item) return
    model.focusPath(activeRelativePath)
    item.select()
  }, [activeRelativePath, model, snapshot.paths])

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

    const absolutePath = toAbsolutePath(worktreePath, relativePath)
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
  }, [model, openFileInSplit, openFileTab, openMarkdownPreview, syncExpandedPaths, worktreePath])

  const handleTreeDragStart = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const target = getTreeItemElement(event.nativeEvent)
    if (!target || target.dataset.itemType !== 'file') return

    const relativePath = target.dataset.itemPath
    if (!relativePath || !event.dataTransfer) return

    const absolutePath = toAbsolutePath(worktreePath, relativePath)
    event.dataTransfer.setData(CONSTELLAGENT_PATH_MIME, absolutePath)
    event.dataTransfer.setData('text/plain', absolutePath)
    event.dataTransfer.effectAllowed = 'copy'
  }, [worktreePath])

  return (
    <div
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
  )
}
