// Mac-local project folder RPCs used by the iOS companion before thread/start.
// Mirrors the Constellagent Desktop "Chats" layout:
// ~/Documents/Constellagent/<YYYY-MM-DD>/<slug>

import { mkdir, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import { app } from 'electron'

export interface MobileProjectLocation {
  id: string
  label: string
  path: string
}

export interface MobileProjectDirectoryEntry {
  name: string
  path: string
  isSymlink: boolean
}

function resolveDocumentsPath(): string {
  try {
    return app.getPath('documents')
  } catch {
    return join(homedir(), 'Documents')
  }
}

export function resolveConstellagentHome(): string {
  return join(resolveDocumentsPath(), 'Constellagent')
}

export function resolveProjectlessChatRoots(): {
  roots: string[]
  constellagentHome: string
  documentedThreadsRoot: string
  desktopDocumentsRoot: string
} {
  const constellagentHome = resolveConstellagentHome()
  const desktopDocumentsRoot = resolveDocumentsPath()
  return {
    roots: [constellagentHome],
    constellagentHome,
    documentedThreadsRoot: constellagentHome,
    desktopDocumentsRoot,
  }
}

export function listProjectQuickLocations(): MobileProjectLocation[] {
  const home = homedir()
  const documents = resolveDocumentsPath()
  const constellagentHome = resolveConstellagentHome()
  return [
    { id: 'constellagent-home', label: 'Constellagent Chats', path: constellagentHome },
    { id: 'documents', label: 'Documents', path: documents },
    { id: 'desktop', label: 'Desktop', path: join(home, 'Desktop') },
    { id: 'home', label: 'Home', path: home },
  ]
}

function slugifyPromptHint(hint: unknown): string {
  if (typeof hint !== 'string') return 'new-chat'
  const slug = hint
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'new-chat'
}

export async function createRootlessChatRoot(promptHint?: unknown): Promise<string> {
  const dateSegment = new Date().toISOString().slice(0, 10)
  const slug = slugifyPromptHint(promptHint)
  const target = join(resolveConstellagentHome(), dateSegment, slug)
  await mkdir(target, { recursive: true })
  return target
}

export async function listProjectDirectory(path: string, limit = 200): Promise<{
  path: string
  parentPath: string | null
  entries: MobileProjectDirectoryEntry[]
}> {
  const absolute = resolvePath(path)
  const info = await stat(absolute)
  if (!info.isDirectory()) {
    throw new Error('Path is not a directory')
  }
  const names = await readdir(absolute)
  const entries: MobileProjectDirectoryEntry[] = []
  for (const name of names) {
    if (entries.length >= limit) break
    const childPath = join(absolute, name)
    const childInfo = await stat(childPath).catch(() => null)
    if (!childInfo?.isDirectory()) continue
    entries.push({
      name,
      path: childPath,
      isSymlink: childInfo.isSymbolicLink?.() ?? false,
    })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  const parent = dirname(absolute)
  return {
    path: absolute,
    parentPath: parent !== absolute ? parent : null,
    entries,
  }
}

export async function createProjectDirectory(parentPath: string, name: string): Promise<string> {
  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('Directory name is required')
  const target = join(resolvePath(parentPath), trimmedName)
  await mkdir(target, { recursive: false })
  return target
}

export async function searchProjectDirectories(
  rootPath: string,
  query: string,
  limit = 80,
): Promise<MobileProjectDirectoryEntry[]> {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []
  const root = resolvePath(rootPath)
  const matches: MobileProjectDirectoryEntry[] = []

  async function walk(current: string, depth: number): Promise<void> {
    if (matches.length >= limit || depth > 6) return
    const names = await readdir(current).catch(() => [])
    for (const name of names) {
      if (matches.length >= limit) return
      const childPath = join(current, name)
      const info = await stat(childPath).catch(() => null)
      if (!info?.isDirectory()) continue
      if (name.toLowerCase().includes(normalizedQuery)) {
        matches.push({
          name,
          path: childPath,
          isSymlink: info.isSymbolicLink?.() ?? false,
        })
      }
      await walk(childPath, depth + 1)
    }
  }

  await walk(root, 0)
  matches.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return matches
}

export async function handleMobileProjectMethod(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case 'project/quickLocations':
      return { locations: listProjectQuickLocations() }
    case 'project/projectlessRoots':
      return resolveProjectlessChatRoots()
    case 'project/createRootlessChatRoot':
      return { path: await createRootlessChatRoot(params.promptHint) }
    case 'project/listDirectory': {
      const path = typeof params.path === 'string' ? params.path : ''
      const limit = typeof params.limit === 'number' ? params.limit : 200
      return await listProjectDirectory(path, limit)
    }
    case 'project/createDirectory': {
      const parentPath = typeof params.parentPath === 'string' ? params.parentPath : ''
      const name = typeof params.name === 'string' ? params.name : ''
      return { path: await createProjectDirectory(parentPath, name) }
    }
    case 'project/searchDirectories': {
      const path = typeof params.path === 'string' ? params.path : ''
      const query = typeof params.query === 'string' ? params.query : ''
      const limit = typeof params.limit === 'number' ? params.limit : 80
      return { entries: await searchProjectDirectories(path, query, limit) }
    }
    default:
      throw new Error(`Unsupported project method: ${method}`)
  }
}

export function isMobileProjectMethod(method: string): boolean {
  return method.startsWith('project/')
}

export const __testing = {
  slugifyPromptHint,
  resolveConstellagentHome,
}
