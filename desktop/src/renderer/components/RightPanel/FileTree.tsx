import { useEffect, useState, useCallback, useRef } from 'react'
import { Tree, NodeRendererProps, NodeApi } from 'react-arborist'
import { useAppStore } from '../../store/app-store'
import styles from './RightPanel.module.css'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  gitStatus?: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
}

interface Props {
  worktreePath: string
  isActive?: boolean
}

function basename(p: string) {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

/** Recursively open or close all descendants of a node */
function toggleRecursive(node: NodeApi<FileNode>) {
  if (node.isOpen) {
    closeRecursive(node)
  } else {
    openRecursive(node)
  }
}

function openRecursive(node: NodeApi<FileNode>) {
  node.open()
  if (node.children) {
    for (const child of node.children) {
      if (child.isInternal) openRecursive(child)
    }
  }
}

function closeRecursive(node: NodeApi<FileNode>) {
  if (node.children) {
    for (const child of node.children) {
      if (child.isInternal) closeRecursive(child)
    }
  }
  node.close()
}

const GIT_STATUS_CLASS: Record<string, string> = {
  modified: styles.gitModified,
  added: styles.gitAdded,
  deleted: styles.gitDeleted,
  renamed: styles.gitRenamed,
  untracked: styles.gitUntracked,
}

function Node({ node, style }: NodeRendererProps<FileNode>) {
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tabs = useAppStore((s) => s.tabs)
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openFileInSplit = useAppStore((s) => s.openFileInSplit)

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isActiveFile =
    node.isLeaf &&
    activeTab?.type === 'file' &&
    activeTab.filePath === node.data.path

  const gitClass = node.data.gitStatus
    ? GIT_STATUS_CLASS[node.data.gitStatus] || ''
    : ''

  const handleClick = (e: React.MouseEvent) => {
    if (node.isInternal) {
      if (e.altKey) {
        toggleRecursive(node)
      } else {
        node.toggle()
      }
    } else if (e.metaKey || e.ctrlKey) {
      // Cmd+click (macOS) / Ctrl+click (other) — open in split pane
      openFileInSplit(node.data.path)
    } else {
      openFileTab(node.data.path)
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!node.isLeaf) return
    e.preventDefault()
    e.stopPropagation()

    // Show a minimal context menu positioned at the mouse
    const existingMenu = document.querySelector('[data-file-context-menu]')
    if (existingMenu) existingMenu.remove()

    const menu = document.createElement('div')
    menu.setAttribute('data-file-context-menu', '')
    menu.style.cssText = `
      position: fixed;
      left: ${e.clientX}px;
      top: ${e.clientY}px;
      background: var(--surface-3, #2a2b3d);
      border: 1px solid var(--border-subtle, #3b3d57);
      border-radius: 6px;
      padding: 4px;
      z-index: 9999;
      min-width: 160px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      font-family: var(--font-ui, -apple-system, sans-serif);
      font-size: 12px;
    `

    const openInSplitItem = document.createElement('div')
    openInSplitItem.textContent = 'Open in Split Pane'
    openInSplitItem.style.cssText = `
      padding: 6px 12px;
      color: var(--text-primary, #c0caf5);
      cursor: pointer;
      border-radius: 4px;
    `
    openInSplitItem.onmouseenter = () => {
      openInSplitItem.style.background = 'var(--surface-4, rgba(255,255,255,0.06))'
    }
    openInSplitItem.onmouseleave = () => {
      openInSplitItem.style.background = 'none'
    }
    openInSplitItem.onclick = () => {
      openFileInSplit(node.data.path)
      menu.remove()
    }

    const openInTabItem = document.createElement('div')
    openInTabItem.textContent = 'Open in New Tab'
    openInTabItem.style.cssText = `
      padding: 6px 12px;
      color: var(--text-primary, #c0caf5);
      cursor: pointer;
      border-radius: 4px;
    `
    openInTabItem.onmouseenter = () => {
      openInTabItem.style.background = 'var(--surface-4, rgba(255,255,255,0.06))'
    }
    openInTabItem.onmouseleave = () => {
      openInTabItem.style.background = 'none'
    }
    openInTabItem.onclick = () => {
      openFileTab(node.data.path)
      menu.remove()
    }

    menu.appendChild(openInSplitItem)
    menu.appendChild(openInTabItem)
    document.body.appendChild(menu)

    // Close on click outside or escape
    const closeMenu = () => {
      menu.remove()
      document.removeEventListener('mousedown', onOutsideClick)
      document.removeEventListener('keydown', onEscape)
    }
    const onOutsideClick = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) closeMenu()
    }
    const onEscape = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeMenu()
    }
    // Defer listeners so the current event doesn't trigger them
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', onOutsideClick)
      document.addEventListener('keydown', onEscape)
    })
  }

  return (
    <div
      style={style}
      className={`${styles.treeNode} ${isActiveFile ? styles.treeNodeActive : ''}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <span className={styles.treeChevron}>
        {node.isInternal ? (node.isOpen ? '▾' : '▸') : ''}
      </span>
      <span className={`${styles.treeName} ${gitClass}`}>
        {node.data.name}
      </span>
    </div>
  )
}

export function FileTree({ worktreePath, isActive }: Props) {
  const [tree, setTree] = useState<FileNode[] | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(400)

  const fetchTree = useCallback(() => {
    window.api.fs.getTreeWithStatus(worktreePath).then((nodes: FileNode[]) => {
      // Wrap in root node
      const root: FileNode = {
        name: basename(worktreePath),
        path: worktreePath,
        type: 'directory',
        children: nodes,
      }
      setTree([root])
    }).catch(() => {})
  }, [worktreePath])

  // Initial fetch
  useEffect(() => {
    fetchTree()
  }, [fetchTree])

  // Auto-refresh on filesystem changes
  useEffect(() => {
    window.api.fs.watchDir(worktreePath)
    const unsub = window.api.fs.onDirChanged((changedDir: string) => {
      if (changedDir === worktreePath) fetchTree()
    })
    return () => {
      unsub()
      window.api.fs.unwatchDir(worktreePath)
    }
  }, [worktreePath, fetchTree])

  // Re-fetch when tab becomes visible (git ops only touch .git/ which the watcher ignores)
  useEffect(() => {
    if (isActive) fetchTree()
  }, [isActive, fetchTree])

  // Measure container height for virtualization
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setHeight(entry.contentRect.height)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={containerRef} className={styles.treeContainer}>
      {!tree ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyText}>Loading files...</span>
        </div>
      ) : (
        <Tree<FileNode>
          key={worktreePath}
          data={tree}
          idAccessor="path"
          openByDefault={false}
          initialOpenState={{ [worktreePath]: true }}
          disableDrag={true}
          disableDrop={true}
          disableEdit={true}
          disableMultiSelection={true}
          rowHeight={26}
          indent={14}
          width="100%"
          height={height}
        >
          {Node}
        </Tree>
      )}
    </div>
  )
}
