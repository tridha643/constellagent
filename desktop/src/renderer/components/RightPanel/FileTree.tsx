import { FileTree as TreesFileTree, useFileTree } from '@pierre/trees/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store/app-store'
import { useFileWatcher } from '../../hooks/useFileWatcher'
import { CONSTELLAGENT_PATH_MIME } from '../../utils/add-to-chat'
import { isMarkdownDocumentPath } from '../../utils/markdown-path'
import { getFileTreeIconsForAppearance } from '../../utils/file-presentation'
import { buildFileTreeSnapshot, findDirectoryNode, readExpandedDirectoryPaths, type FileNode, type FileTreeSnapshot } from './file-tree-adapter'
import { fileTreeActions } from './file-tree-actions'
import { ensureLetterBadgeSheet, findTreeShadowRoot } from './file-tree-shadow-css'
import { createTrailingDebounce } from '../../utils/debounce'
import styles from './RightPanel.module.css'

interface Props {
  worktreePath: string
  isActive?: boolean
}

const EMPTY_PATHS: string[] = []
const EMPTY_SNAPSHOT: FileTreeSnapshot = { paths: [], gitStatus: [] }
// Coalesce watcher / git:files-changed bursts into one refresh. A longer window
// on huge repos trades a touch of latency for far fewer whole-repo git calls.
const REFRESH_DEBOUNCE_MS = 120
const HUGE_REFRESH_DEBOUNCE_MS = 250
// Max concurrent directory re-lists during a refresh (siblings are distinct nodes).
const REFRESH_LIST_CONCURRENCY = 8

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
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const treeIcons = useMemo(() => getFileTreeIconsForAppearance(appearanceThemeId), [appearanceThemeId])

  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const openFileTab = useAppStore((s) => s.openFileTab)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const openFileInSplit = useAppStore((s) => s.openFileInSplit)
  const showConfirmDialog = useAppStore((s) => s.showConfirmDialog)
  const dismissConfirmDialog = useAppStore((s) => s.dismissConfirmDialog)
  const addToast = useAppStore((s) => s.addToast)
  const workspaceId = useAppStore((s) =>
    s.workspaces.find((w) => w.worktreePath === worktreePath)?.id ?? null,
  )
  const setFileTreeExpandedPaths = useAppStore((s) => s.setFileTreeExpandedPaths)
  // Repo-wide git status, shared with the Changes tab via the store. The tree
  // overlays it onto rows instead of asking main for status per folder expand.
  const gitStatusMap = useAppStore((s) => s.gitFileStatuses.get(worktreePath))
  const setGitFileStatuses = useAppStore((s) => s.setGitFileStatuses)

  const requestIdRef = useRef(0)
  const expandedPathsRef = useRef<string[]>([])
  // Last path-set applied to pierre via resetPaths. The status-rebuild effect
  // fires on every git-status tick and allocates a fresh-but-identical
  // snapshot.paths array; skipping resetPaths when the structural key is
  // unchanged avoids re-seeding pierre's expansion on pure status churn. Reset
  // on worktree switch so the first snapshot always rebuilds.
  const lastPathsKeyRef = useRef<string | null>(null)
  // Last git-status overlay applied to pierre. setGitStatus re-touches every row;
  // skip it when the overlay value is unchanged so a busy repo's watcher/status
  // churn doesn't re-apply an identical overlay on every tick.
  const lastGitStatusKeyRef = useRef<string | null>(null)
  const treeContainerRef = useRef<HTMLDivElement | null>(null)
  /**
   * Lazy tree state (VS Code's getChildren-on-expand model). `treeNodesRef` holds
   * only the directory levels loaded so far; `loadedDirsRef` tracks which dirs
   * have had their children fetched so re-expansion is instant and we never walk
   * the whole repo up front. Pierre renders a directory with no children as a
   * (non-chevron) folder row; clicking it triggers `loadDir`, which fills in the
   * children and re-renders it expanded.
   */
  const treeNodesRef = useRef<FileNode[]>([])
  const loadedDirsRef = useRef<Set<string>>(new Set())
  const loadingDirsRef = useRef<Set<string>>(new Set())
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
    icons: treeIcons,
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

  const expansionWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The active-file row we still need to focus + select. Set when the active tab
  // changes; cleared once focused. Completion is driven by the resetPaths layout
  // effect (which fires exactly when a lazily-loaded row mounts) — no polling
  // rAF loop — and it self-clears, so later structural rebuilds never re-focus an
  // already-revealed file (that re-focus was the scroll-pull jank).
  const pendingFocusPathRef = useRef<string | null>(null)

  const syncExpandedPaths = useCallback(() => {
    expandedPathsRef.current = readExpandedDirectoryPaths(model.getFileTreeContainer() ?? null)
    // Debounced persist: file tree expansion is a per-workspace UI hint,
    // so it survives quit/restart without thrashing disk on every click.
    if (!workspaceId) return
    if (expansionWriteTimerRef.current) clearTimeout(expansionWriteTimerRef.current)
    expansionWriteTimerRef.current = setTimeout(() => {
      setFileTreeExpandedPaths(workspaceId, expandedPathsRef.current)
    }, 500)
  }, [model, workspaceId, setFileTreeExpandedPaths])

  /** Focus + select the pending active-file row if it now exists in pierre's
   * model. No-op (and harmless) until the row is present, so it can be called
   * after every structural rebuild to complete a deep reveal without polling. */
  const completeRevealFocus = useCallback(() => {
    const target = pendingFocusPathRef.current
    if (!target) return
    try {
      const item = model.getItem(target)
      if (!item) return
      model.focusPath(target)
      item.select()
      pendingFocusPathRef.current = null
      syncExpandedPaths()
    } catch (err) {
      console.error('[FileTree] focus selection failed:', err)
      pendingFocusPathRef.current = null
    }
  }, [model, syncExpandedPaths])

  // Resolved (realpath'd) root, mirrored into a ref so the lazy loaders below
  // can build absolute child paths without re-rendering on every state read.
  const treeRootRef = useRef(worktreePath)
  // Latest status overlay, mirrored into a ref so the (ref-only) rebuildSnapshot
  // and lazy loaders see it without being re-created on every status change.
  const gitStatusMapRef = useRef<ReadonlyMap<string, string> | undefined>(gitStatusMap)

  const rebuildSnapshot = useCallback(() => {
    setSnapshot(buildFileTreeSnapshot(treeRootRef.current, treeNodesRef.current, gitStatusMapRef.current))
  }, [])

  /** Fetch repo-wide git status once and publish it to the shared store. The
   * Changes tab does the same; main-side caching (getStatusCached) coalesces.
   * Status paths are repo-root-relative; the overlay matches them against
   * worktree-root-relative tree paths. These agree because a workspace
   * worktreePath is always a git top-level (no `--show-prefix`); a workspace
   * rooted at a git subdirectory would need the prefix stripped here. */
  const refreshGitStatus = useCallback(async () => {
    try {
      const statuses = await window.api.git.getStatus(worktreePath)
      const map = new Map<string, string>()
      for (const s of statuses) map.set(s.path, s.status)
      setGitFileStatuses(worktreePath, map)
    } catch {
      // Best effort — stale dots beat a crash.
    }
  }, [worktreePath, setGitFileStatuses])

  /** Fetch + attach one directory's immediate children (no-op if already loaded). */
  const loadDir = useCallback(async (absDir: string, expandRelPath?: string) => {
    if (loadedDirsRef.current.has(absDir) || loadingDirsRef.current.has(absDir)) return
    loadingDirsRef.current.add(absDir)
    try {
      const { entries } = await window.api.fs.listDirectory(treeRootRef.current, absDir)
      const node = findDirectoryNode(treeNodesRef.current, absDir)
      if (node) node.children = entries as FileNode[]
      loadedDirsRef.current.add(absDir)
      // Capture Pierre's current expansion, then force the just-opened dir open
      // so the resetPaths layout effect re-renders it expanded with its children.
      syncExpandedPaths()
      if (expandRelPath && !expandedPathsRef.current.includes(expandRelPath)) {
        expandedPathsRef.current = [...expandedPathsRef.current, expandRelPath]
      }
      rebuildSnapshot()
    } finally {
      loadingDirsRef.current.delete(absDir)
    }
  }, [rebuildSnapshot, syncExpandedPaths])

  /** Initial (root-level) load. Restores previously-expanded folders by loading
   * their child levels, so reopened worktrees come back to the same shape. */
  const loadRoot = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    try {
      const { rootPath, entries } = await window.api.fs.listDirectory(worktreePath, worktreePath)
      if (requestId !== requestIdRef.current) return
      treeRootRef.current = rootPath
      setTreeRoot(rootPath)
      treeNodesRef.current = entries as FileNode[]
      loadedDirsRef.current = new Set([rootPath])
      loadingDirsRef.current = new Set()

      // Re-open persisted folders shallow→deep so each parent is loaded first.
      const seed = [...expandedPathsRef.current].sort((a, b) => a.split('/').length - b.split('/').length)
      for (const rel of seed) {
        if (requestId !== requestIdRef.current) return
        await loadDir(toAbsolutePath(rootPath, rel))
      }
      if (requestId !== requestIdRef.current) return
      expandedPathsRef.current = seed
      rebuildSnapshot()
      setIsLoaded(true)
    } catch {
      if (requestId !== requestIdRef.current) return
      treeRootRef.current = worktreePath
      setTreeRoot(worktreePath)
      treeNodesRef.current = []
      setSnapshot(EMPTY_SNAPSHOT)
      setIsLoaded(true)
    }
  }, [loadDir, rebuildSnapshot, worktreePath])

  /** Re-list every currently-loaded directory (for watcher / mutation refreshes)
   * — bounded by what the user actually opened, never the whole repo. */
  const refreshLoaded = useCallback(async () => {
    const root = treeRootRef.current
    if (!loadedDirsRef.current.has(root)) {
      void loadRoot()
      return
    }
    syncExpandedPaths()

    // Build the refreshed tree on a LOCAL working copy and swap it into
    // treeNodesRef atomically at the very end. The old code mutated
    // treeNodesRef in place: it replaced the root array with fresh entries
    // (children not yet re-attached) and only re-attached each level across
    // later awaits. A concurrent rebuildSnapshot — e.g. refreshGitStatus runs
    // in the same Promise.all and its setGitFileStatuses fires the status
    // effect — would then read a half-rebuilt tree where an expanded folder
    // momentarily has no children, collapse it via resetPaths, then re-expand
    // when the refresh finished. That interleaving is the busy-repo open/close
    // flicker. Working off a clone keeps every concurrent read pointed at the
    // previous COMPLETE tree until the new one is fully assembled.
    let working: FileNode[] = treeNodesRef.current

    const relistOne = async (absDir: string) => {
      try {
        const { entries } = await window.api.fs.listDirectory(root, absDir)
        if (absDir === root) {
          working = entries as FileNode[]
        } else {
          const node = findDirectoryNode(working, absDir)
          if (node) node.children = entries as FileNode[]
        }
      } catch {
        // Directory vanished (deleted/renamed) — drop it; parent refresh reconciles.
        loadedDirsRef.current.delete(absDir)
      }
    }

    // Re-list level-by-level (shallow→deep): a child re-list attaches onto the
    // node its parent's re-list just produced, so levels must stay ordered. But
    // within a level the dirs are distinct nodes, so list them bounded-parallel.
    const byDepth = new Map<number, string[]>()
    for (const absDir of loadedDirsRef.current) {
      const depth = absDir.split('/').length
      const bucket = byDepth.get(depth)
      if (bucket) bucket.push(absDir)
      else byDepth.set(depth, [absDir])
    }
    for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
      const levelDirs = byDepth.get(depth)!
      let next = 0
      const worker = async () => {
        while (next < levelDirs.length) {
          const absDir = levelDirs[next]
          next += 1
          await relistOne(absDir)
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(REFRESH_LIST_CONCURRENCY, levelDirs.length) }, () => worker()),
      )
    }
    // Atomic swap: only now does any concurrent reader see the new tree.
    treeNodesRef.current = working
    rebuildSnapshot()
  }, [loadRoot, rebuildSnapshot, syncExpandedPaths])

  // Back-compat alias: existing call sites (create/delete/reveal) expect a single
  // "refresh the tree" entry point; lazily that means re-listing loaded dirs.
  const fetchTree = refreshLoaded

  // External change (file watcher / git:files-changed): refresh both the
  // structure (re-list loaded dirs) and the status overlay. These are decoupled
  // now — folder expands re-list structure only; status flows from the store.
  // Returns a Promise so the trailing debounce can await it (drop-while-busy):
  // a watcher burst never overlaps two refreshes or thrashes the path store.
  const handleExternalChange = useCallback(
    () => Promise.all([fetchTree(), refreshGitStatus()]).then(() => {}),
    [fetchTree, refreshGitStatus],
  )

  // Set by the huge-repo probe (one-shot on load) to widen the debounce window.
  const isHugeRef = useRef(false)
  useEffect(() => {
    isHugeRef.current = false
    let cancelled = false
    window.api.git
      .isRepositoryHuge(worktreePath)
      .then((huge) => {
        if (!cancelled) isHugeRef.current = huge
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [worktreePath])
  // Always call the latest handler; keep the debounce instance itself stable so a
  // handler-identity change never drops a pending refresh.
  const handleExternalChangeRef = useRef(handleExternalChange)
  handleExternalChangeRef.current = handleExternalChange
  const scheduleExternalChange = useMemo(
    () =>
      createTrailingDebounce(
        () => handleExternalChangeRef.current(),
        () => (isHugeRef.current ? HUGE_REFRESH_DEBOUNCE_MS : REFRESH_DEBOUNCE_MS),
      ),
    [],
  )
  useEffect(() => () => scheduleExternalChange.cancel(), [scheduleExternalChange])

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
    // Drop the lazily-loaded tree so the new worktree re-loads from its root.
    treeRootRef.current = worktreePath
    treeNodesRef.current = []
    loadedDirsRef.current = new Set()
    loadingDirsRef.current = new Set()
    // Force the next snapshot to rebuild expansion + re-apply status for the
    // new worktree.
    lastPathsKeyRef.current = null
    lastGitStatusKeyRef.current = null
    // Seed expansion from the persisted per-workspace map so reopened
    // worktrees come back with their previously open folders intact. Read
    // through getState() so persistence writes don't re-trigger this effect
    // (which would cause flicker mid-interaction).
    const seed = workspaceId
      ? useAppStore.getState().fileTreeExpandedPathsByWorkspace[workspaceId]
      : undefined
    expandedPathsRef.current = seed ? [...seed] : []
    if (expansionWriteTimerRef.current) {
      clearTimeout(expansionWriteTimerRef.current)
      expansionWriteTimerRef.current = null
    }
    // Persisted paths missing from the live tree fail silently in pierre;
    // we filter them once the snapshot lands via the resetPaths layout effect.
  }, [worktreePath, workspaceId])

  useEffect(() => {
    if (!isActive) return
    handleExternalChange()
  }, [handleExternalChange, isActive])

  // Status-only update: when the shared status map changes (Changes tab refresh,
  // our own refreshGitStatus, a branch switch), rebuild the snapshot WITHOUT
  // re-listing any directories. Cheap O(n) overlay pass over the loaded tree.
  useEffect(() => {
    gitStatusMapRef.current = gitStatusMap
    if (isLoaded) rebuildSnapshot()
  }, [gitStatusMap, isLoaded, rebuildSnapshot])

  useEffect(() => {
    return () => {
      if (expansionWriteTimerRef.current) {
        clearTimeout(expansionWriteTimerRef.current)
        expansionWriteTimerRef.current = null
        // Flush any pending expansion write so unmount doesn't drop it.
        if (workspaceId) {
          setFileTreeExpandedPaths(workspaceId, expandedPathsRef.current)
        }
      }
    }
  }, [workspaceId, setFileTreeExpandedPaths])

  useFileWatcher(worktreePath, scheduleExternalChange, Boolean(isActive))

  useEffect(() => {
    if (!isActive) return
    const onGitFilesChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ worktreePath?: string }>).detail
      if (detail?.worktreePath === worktreePath) scheduleExternalChange()
    }
    window.addEventListener('git:files-changed', onGitFilesChanged)
    return () => window.removeEventListener('git:files-changed', onGitFilesChanged)
  }, [scheduleExternalChange, isActive, worktreePath])

  useLayoutEffect(() => {
    try {
      // resetPaths() rebuilds pierre's expansion from expandedPathsRef. But
      // buildFileTreeSnapshot allocates a fresh `paths` array on every rebuild,
      // so a status-only update (effect below, firing on each git-status tick —
      // frequent on busy repos) changes snapshot.paths by *identity* while the
      // structure is byte-identical. Gate resetPaths on a structural key so it
      // fires only when the path SET actually changes; pure status churn just
      // re-overlays via setGitStatus. (The busy-repo open/close flicker itself
      // is fixed in refreshLoaded — see the atomic-swap note there.)
      const pathsKey = snapshot.paths.join('\n')
      const pathsChanged = lastPathsKeyRef.current !== pathsKey
      if (pathsChanged) {
        lastPathsKeyRef.current = pathsKey
        model.resetPaths(snapshot.paths, {
          initialExpandedPaths: expandedPathsRef.current,
        })
      }
      // resetPaths clears the status overlay, so re-apply after a structural
      // rebuild regardless. Otherwise only re-apply when the overlay value
      // actually changed — setGitStatus re-touches every row, so re-applying an
      // identical overlay on each watcher/status tick is wasted render work.
      const gitStatusKey = snapshot.gitStatus
        .map((s) => `${s.path}\t${s.status}`)
        .join('\n')
      if (pathsChanged || lastGitStatusKeyRef.current !== gitStatusKey) {
        lastGitStatusKeyRef.current = gitStatusKey
        model.setGitStatus(snapshot.gitStatus)
      }
      model.setIcons(treeIcons)
      // A structural rebuild may have just mounted a row a pending reveal was
      // waiting for (e.g. a deep file whose ancestors lazily loaded). Complete it
      // here, synchronously after resetPaths — gated on pathsChanged so pure
      // status churn doesn't poke it. No-op when nothing is pending.
      if (pathsChanged) completeRevealFocus()
    } catch (err) {
      console.error('[FileTree] model sync failed:', err)
    }
  }, [model, snapshot.gitStatus, snapshot.paths, treeIcons, completeRevealFocus])

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

  // Reveal the active file (expand its ancestors, focus + select its row) when
  // the active tab changes — NOT on every structural rebuild. This effect used
  // to also depend on `snapshot.paths`, so any unrelated structural change
  // (lazy folder expand, watcher refresh) re-fired it and re-focused the active
  // file, yanking pierre's viewport back to that file mid-interaction — the
  // "expanding a folder pulls me back to the old clicked folder" jank. We now
  // key only on the active path (+ isLoaded for the first post-load reveal). The
  // actual focus is recorded as "pending" and completed by the resetPaths layout
  // effect once the (possibly lazily-loaded) row mounts — no per-frame rAF poll.
  // `isLoaded` flips once per worktree and stays true, so this never re-fires on
  // expands/refreshes.
  useEffect(() => {
    if (!isLoaded || !activeRelativePath) return
    let cancelled = false
    pendingFocusPathRef.current = activeRelativePath

    const reveal = async () => {
      // Lazy reveal: load + expand every ancestor directory so a deeply-nested
      // file (opened via quick-open / Cmd-P, a tab click, etc.) becomes visible.
      // Directory paths in this tree carry a trailing slash; file paths do not.
      const segments = activeRelativePath.split('/')
      for (let i = 1; i < segments.length; i++) {
        if (cancelled) return
        const ancestorPath = `${segments.slice(0, i).join('/')}/`
        const absAncestor = toAbsolutePath(treeRootRef.current, ancestorPath)
        if (!loadedDirsRef.current.has(absAncestor)) {
          await loadDir(absAncestor, ancestorPath)
          continue
        }
        const ancestor = model.getItem(ancestorPath)
        if (!ancestor || !ancestor.isDirectory()) continue
        const directory = ancestor as typeof ancestor & { isExpanded(): boolean; expand(): void }
        if (!directory.isExpanded()) {
          directory.expand()
          if (!expandedPathsRef.current.includes(ancestorPath)) {
            expandedPathsRef.current = [...expandedPathsRef.current, ancestorPath]
          }
        }
      }
      if (cancelled) return
      // Complete now if the row already exists (the common case: switching to or
      // opening an already-loaded file). When ancestors were lazily loaded the
      // row isn't committed yet — the resetPaths layout effect completes it after
      // the rebuild lands.
      completeRevealFocus()
    }

    void reveal()
    return () => { cancelled = true }
  }, [activeRelativePath, isLoaded, model, loadDir, completeRevealFocus])

  const handleTreeClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement | null)?.closest?.('[data-file-tree-context-menu-root="true"]')) return

    const target = getTreeItemElement(event.nativeEvent)
    if (!target) return

    const relativePath = target.dataset.itemPath
    const itemType = target.dataset.itemType
    if (!relativePath || !itemType) return

    if (itemType === 'folder') {
      // Mirror the toggle Pierre is about to perform into expandedPathsRef *now*,
      // synchronously in the capture phase before Pierre's own click handler runs.
      // resetPaths() rebuilds expansion entirely from initialExpandedPaths, so a
      // structural rebuild landing between this click and the post-toggle
      // syncExpandedPaths below would otherwise replay a stale ref and collapse
      // the folder the user just opened. Read the live pre-toggle state from the
      // model so we invert exactly what Pierre will do, falling back to ref
      // membership.
      const liveItem = model.getItem(relativePath)
      const isExpandedNow = liveItem?.isDirectory()
        ? (liveItem as typeof liveItem & { isExpanded(): boolean }).isExpanded()
        : expandedPathsRef.current.includes(relativePath)
      if (isExpandedNow) {
        expandedPathsRef.current = expandedPathsRef.current.filter((p) => p !== relativePath)
      } else if (!expandedPathsRef.current.includes(relativePath)) {
        expandedPathsRef.current = [...expandedPathsRef.current, relativePath]
      }

      // Lazy load: first time a folder is opened, fetch its children and render
      // it expanded. Already-loaded folders just let Pierre toggle normally.
      const absDir = toAbsolutePath(treeRoot, relativePath)
      if (!loadedDirsRef.current.has(absDir)) {
        void loadDir(absDir, relativePath)
      }
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
  }, [loadDir, model, openFileInSplit, openFileTab, openMarkdownPreview, syncExpandedPaths, treeRoot])

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
