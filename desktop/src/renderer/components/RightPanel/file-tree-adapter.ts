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

function pushUnique(list: string[], value: string) {
  if (!value || list.includes(value)) return
  list.push(value)
}

function pushUniqueStatus(list: GitStatusEntry[], entry: GitStatusEntry) {
  if (list.some((candidate) => candidate.path === entry.path && candidate.status === entry.status)) return
  list.push(entry)
}

export function buildFileTreeSnapshot(rootPath: string, nodes: FileNode[]): FileTreeSnapshot {
  const paths: string[] = []
  const gitStatus: GitStatusEntry[] = []

  const walk = (entries: FileNode[]) => {
    for (const entry of entries) {
      const relativePath = relativeToRoot(rootPath, entry.path)
      if (!relativePath) continue

      const canonicalPath = entry.type === 'directory'
        ? toDirectoryPath(relativePath)
        : relativePath

      pushUnique(paths, canonicalPath)

      if (entry.gitStatus) {
        pushUniqueStatus(gitStatus, {
          path: canonicalPath,
          status: entry.gitStatus,
        })
      }

      if (entry.type === 'directory' && entry.children?.length) {
        walk(entry.children)
      }
    }
  }

  walk(nodes)
  return { gitStatus, paths }
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
