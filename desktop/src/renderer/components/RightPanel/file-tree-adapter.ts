import type { GitStatusEntry } from '@pierre/trees'

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  gitStatus?: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
}

export interface FileTreeSnapshot {
  gitStatus: GitStatusEntry[]
  paths: string[]
}

function normalizeRootPath(path: string): string {
  return path.replace(/[\\/]+$/, '')
}

function relativeToRoot(rootPath: string, targetPath: string): string {
  const normalizedRoot = normalizeRootPath(rootPath)
  if (targetPath === normalizedRoot) return ''
  if (targetPath.startsWith(`${normalizedRoot}/`)) return targetPath.slice(normalizedRoot.length + 1)
  return targetPath.replace(/\\/g, '/')
}

function toDirectoryPath(path: string): string {
  return path.endsWith('/') ? path : `${path}/`
}

/** Repo-root-relative status path, resolving git's `old -> new` rename form. */
function normalizeStatusPath(p: string): string {
  const renameIdx = p.indexOf(' -> ')
  const resolved = renameIdx === -1 ? p : p.slice(renameIdx + 4)
  return resolved.replace(/\/+$/, '')
}

/**
 * Build the Pierre tree snapshot (paths + per-row git status).
 *
 * When `gitStatusMap` is supplied (repo-root-relative path → status, from the
 * renderer's `gitFileStatuses` store), status is overlaid here in one O(n) pass:
 * files take their own status and directories roll up to `modified` when any
 * changed path lives under them. This replaces reading per-node status from main
 * (which forced a whole-repo `git status` on every folder expand). Without the
 * map it falls back to each node's `gitStatus` (back-compat).
 */
export function buildFileTreeSnapshot(
  rootPath: string,
  nodes: FileNode[],
  gitStatusMap?: ReadonlyMap<string, string>,
): FileTreeSnapshot {
  const paths: string[] = []
  const gitStatus: GitStatusEntry[] = []
  // The tree from main is already unique by construction (one node per path), so
  // dedup only guards against accidental dupes. Use O(1) Set membership instead
  // of Array.includes / Array.some — the latter made this walk O(n²), which on
  // large repos (10k+ files) cost seconds per tree load (the real load-time bug).
  const seenPaths = new Set<string>()
  const seenStatus = new Set<string>()

  // Pre-index the overlay: file statuses by path, plus the set of directories
  // (trailing-slash) that contain any change, so dir rollup is O(1) per node.
  const fileStatusByPath = new Map<string, string>()
  const changedDirs = new Set<string>()
  if (gitStatusMap) {
    for (const [rawPath, status] of gitStatusMap) {
      const rel = normalizeStatusPath(rawPath)
      if (!rel) continue
      fileStatusByPath.set(rel, status)
      const segments = rel.split('/')
      let prefix = ''
      for (let i = 0; i < segments.length - 1; i += 1) {
        prefix += `${segments[i]}/`
        changedDirs.add(prefix)
      }
    }
  }

  const walk = (entries: FileNode[]) => {
    for (const entry of entries) {
      const relativePath = relativeToRoot(rootPath, entry.path)
      if (!relativePath) continue

      const canonicalPath = entry.type === 'directory'
        ? toDirectoryPath(relativePath)
        : relativePath

      if (!seenPaths.has(canonicalPath)) {
        seenPaths.add(canonicalPath)
        paths.push(canonicalPath)
      }

      const status = gitStatusMap
        ? entry.type === 'directory'
          ? (changedDirs.has(canonicalPath) ? 'modified' : undefined)
          : fileStatusByPath.get(relativePath)
        : entry.gitStatus

      if (status) {
        const statusKey = `${canonicalPath} ${status}`
        if (!seenStatus.has(statusKey)) {
          seenStatus.add(statusKey)
          gitStatus.push({ path: canonicalPath, status: status as GitStatusEntry['status'] })
        }
      }

      if (entry.type === 'directory' && entry.children?.length) {
        walk(entry.children)
      }
    }
  }

  walk(nodes)
  return { gitStatus, paths }
}

/**
 * Find the directory node with the given absolute path in a (possibly partial,
 * lazily-loaded) tree, so the caller can attach its freshly-listed children.
 */
export function findDirectoryNode(nodes: FileNode[], absPath: string): FileNode | null {
  for (const node of nodes) {
    if (node.type !== 'directory') continue
    if (node.path === absPath) return node
    // Only descend into subtrees that could contain the target.
    if (node.children?.length && absPath.startsWith(`${node.path}/`)) {
      const found = findDirectoryNode(node.children, absPath)
      if (found) return found
    }
  }
  return null
}

export function readExpandedDirectoryPaths(container: HTMLElement | null): string[] {
  const root = container?.shadowRoot
  if (!root) return []

  const expanded = root.querySelectorAll<HTMLElement>('[data-item-type="folder"][aria-expanded="true"]')
  const paths = new Set<string>()
  expanded.forEach((entry) => {
    const path = entry.dataset.itemPath
    if (path) paths.add(path)
  })
  return Array.from(paths)
}
