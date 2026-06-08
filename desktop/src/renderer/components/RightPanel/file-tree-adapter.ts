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

export function buildFileTreeSnapshot(rootPath: string, nodes: FileNode[]): FileTreeSnapshot {
  const paths: string[] = []
  const gitStatus: GitStatusEntry[] = []
  // The tree from main is already unique by construction (one node per path), so
  // dedup only guards against accidental dupes. Use O(1) Set membership instead
  // of Array.includes / Array.some — the latter made this walk O(n²), which on
  // large repos (10k+ files) cost seconds per tree load (the real load-time bug).
  const seenPaths = new Set<string>()
  const seenStatus = new Set<string>()

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

      if (entry.gitStatus) {
        const statusKey = `${canonicalPath} ${entry.gitStatus}`
        if (!seenStatus.has(statusKey)) {
          seenStatus.add(statusKey)
          gitStatus.push({ path: canonicalPath, status: entry.gitStatus })
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
