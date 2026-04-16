import { readdir, readFile as fsReadFile, writeFile as fsWriteFile, stat, rm, copyFile, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { join, basename, relative } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { FileFinder as FileFinderType } from '@ff-labs/fff-node'
import {
  AGENT_PLAN_RELATIVE_DIRS,
  PLAN_DIR_TO_AGENT,
  AGENT_TO_PLAN_DIR,
  isAgentPlanPath,
  relativePathInWorktree,
} from '../shared/agent-plan-path'
import type { AgentPlanEntry, PlanAgent, PlanMeta } from '../shared/agent-plan-path'
import type { QuickOpenSearchItem, QuickOpenSearchRequest, QuickOpenSearchResult } from '../shared/quick-open-types'
import { readPlanMetaPrefix, readPlanMeta, writePlanMeta } from './plan-meta'

export { AGENT_PLAN_RELATIVE_DIRS, readPlanMeta, writePlanMeta }

const execFileAsync = promisify(execFile)

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  gitStatus?: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
}

// Directories to always skip
export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.DS_Store', 'dist', 'build',
  '.next', '.cache', '__pycache__', '.venv', 'venv',
  'coverage', '.nyc_output',
])

function toPosixPath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/')
}

function isAlwaysVisibleFileName(name: string): boolean {
  return name === '.gitignore' || name.startsWith('.env')
}

function normalizeRootPath(pathValue: string): string {
  return pathValue.replace(/[\\/]+$/, '') || pathValue
}

function quickOpenScoreTotal(score: { total?: number } | undefined): number {
  return score?.total ?? 0
}

type FffNodeModule = typeof import('@ff-labs/fff-node')
let fffNodeModulePromise: Promise<FffNodeModule> | null = null

function loadFffNodeModule(): Promise<FffNodeModule> {
  if (!fffNodeModulePromise) {
    fffNodeModulePromise = import('@ff-labs/fff-node')
  }
  return fffNodeModulePromise
}

interface QuickOpenFinderState {
  finder: FileFinderType
  ready: Promise<void>
}

interface QuickOpenFallbackFile {
  name: string
  path: string
  relativePath: string
}

export class FileService {
  private static quickOpenFinders = new Map<string, Promise<QuickOpenFinderState>>()
  private static quickOpenFallbackFiles = new Map<string, Promise<QuickOpenFallbackFile[]>>()
  static async getTree(dirPath: string, depth = 0): Promise<FileNode[]> {
    if (depth > 8) return [] // prevent infinite recursion

    // Use git ls-files if in a git repo for gitignore respect
    if (depth === 0) {
      try {
        return await this.getGitTree(dirPath)
      } catch {
        // Fall back to manual traversal
      }
    }

    const entries = await readdir(dirPath, { withFileTypes: true })
    const nodes: FileNode[] = []

    const sorted = entries
      .filter((e) => !e.name.startsWith('.') || isAlwaysVisibleFileName(e.name))
      .filter((e) => !SKIP_DIRS.has(e.name))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })

    for (const entry of sorted) {
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        const children = await this.getTree(fullPath, depth + 1)
        nodes.push({
          name: entry.name,
          path: fullPath,
          type: 'directory',
          children,
        })
      } else {
        nodes.push({
          name: entry.name,
          path: fullPath,
          type: 'file',
        })
      }
    }

    return nodes
  }

  private static async getGitTree(dirPath: string): Promise<FileNode[]> {
    const [{ stdout }, alwaysVisibleFiles] = await Promise.all([
      execFileAsync(
        'git',
        ['ls-files', '--others', '--cached', '--exclude-standard'],
        { cwd: dirPath }
      ),
      this.collectAlwaysVisibleFiles(dirPath),
    ])

    const files = stdout.trim().split('\n').filter(Boolean)
    return this.buildTreeFromPaths(dirPath, [...files, ...alwaysVisibleFiles])
  }

  private static async collectAlwaysVisibleFiles(
    basePath: string,
    relativeDir = '',
    depth = 0,
  ): Promise<string[]> {
    if (depth > 8) return []

    const absoluteDir = relativeDir ? join(basePath, relativeDir) : basePath
    let entries: import('fs').Dirent[]
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true }) as import('fs').Dirent[]
    } catch {
      return []
    }

    const files: string[] = []
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue

      const nextRelativePath = relativeDir ? join(relativeDir, entry.name) : entry.name
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue
        files.push(...await this.collectAlwaysVisibleFiles(basePath, nextRelativePath, depth + 1))
        continue
      }

      if (entry.isFile() && isAlwaysVisibleFileName(entry.name)) {
        files.push(toPosixPath(nextRelativePath))
      }
    }

    return files
  }

  private static buildTreeFromPaths(basePath: string, paths: string[]): FileNode[] {
    const root: FileNode = { name: '', path: basePath, type: 'directory', children: [] }

    for (const filePath of new Set(paths.map((value) => toPosixPath(value)).filter(Boolean))) {
      const parts = filePath.split('/')
      let current = root

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const isFile = i === parts.length - 1
        const fullPath = join(basePath, ...parts.slice(0, i + 1))

        if (isFile) {
          current.children!.push({ name: part, path: fullPath, type: 'file' })
        } else {
          let dir = current.children!.find(
            (c) => c.name === part && c.type === 'directory'
          )
          if (!dir) {
            dir = { name: part, path: fullPath, type: 'directory', children: [] }
            current.children!.push(dir)
          }
          current = dir
        }
      }
    }

    // Sort: directories first, then alphabetical
    const sortNodes = (nodes: FileNode[]): FileNode[] => {
      nodes.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
      })
      for (const node of nodes) {
        if (node.children) sortNodes(node.children)
      }
      return nodes
    }

    return sortNodes(root.children || [])
  }

  static async readFile(filePath: string): Promise<string> {
    return fsReadFile(filePath, 'utf-8')
  }

  static async writeFile(filePath: string, content: string): Promise<void> {
    await fsWriteFile(filePath, content, 'utf-8')
    this.invalidateQuickOpenCachesForPath(filePath)
  }

  static async deleteFile(filePath: string): Promise<void> {
    const info = await stat(filePath)
    await rm(filePath, { recursive: info.isDirectory(), force: false })
    this.invalidateQuickOpenCachesForPath(filePath)
  }

  private static flattenQuickOpenFiles(nodes: FileNode[], basePath: string): QuickOpenFallbackFile[] {
    const result: QuickOpenFallbackFile[] = []

    const walk = (list: FileNode[]) => {
      for (const node of list) {
        if (node.type === 'file') {
          result.push({
            name: node.name,
            path: node.path,
            relativePath: node.path.startsWith(basePath)
              ? node.path.slice(basePath.length + 1)
              : node.path,
          })
          continue
        }
        if (node.children) walk(node.children)
      }
    }

    walk(nodes)
    return result
  }

  private static async getQuickOpenFallbackFiles(worktreePath: string): Promise<QuickOpenFallbackFile[]> {
    const normalizedPath = normalizeRootPath(worktreePath)
    const existing = this.quickOpenFallbackFiles.get(normalizedPath)
    if (existing) return existing

    const created = this.getTree(normalizedPath)
      .then((nodes) => this.flattenQuickOpenFiles(nodes, normalizedPath))
      .catch((error) => {
        this.quickOpenFallbackFiles.delete(normalizedPath)
        throw error
      })

    this.quickOpenFallbackFiles.set(normalizedPath, created)
    return created
  }

  private static fuzzyMatchQuickOpen(query: string, target: string): number[] | null {
    const lowerQuery = query.toLowerCase()
    const lowerTarget = target.toLowerCase()
    const indices: number[] = []
    let qi = 0

    for (let ti = 0; ti < lowerTarget.length && qi < lowerQuery.length; ti += 1) {
      if (lowerTarget[ti] === lowerQuery[qi]) {
        indices.push(ti)
        qi += 1
      }
    }

    return qi === lowerQuery.length ? indices : null
  }

  private static fallbackQuickOpenScore(relativePath: string, indices: number[]): number {
    const nameStart = relativePath.lastIndexOf('/') + 1
    const nameMatchCount = indices.filter((i) => i >= nameStart).length
    return -nameMatchCount * 10 + indices.length + relativePath.length
  }

  private static async fallbackQuickOpenSearch(
    worktreePath: string,
    request: QuickOpenSearchRequest,
    error?: string,
  ): Promise<QuickOpenSearchResult> {
    const query = request.query ?? ''
    const normalizedQuery = query.trim().toLowerCase()
    const limit = Math.max(1, Math.min(request.limit ?? 50, 200))
    const files = await this.getQuickOpenFallbackFiles(worktreePath)

    if (!normalizedQuery) {
      return {
        state: 'ready',
        items: files.slice(0, limit).map((file) => ({
          path: file.path,
          relativePath: file.relativePath,
          fileName: file.name,
          score: 0,
          matchType: 'fallback',
        })),
        totalMatched: files.length,
        totalFiles: files.length,
        error,
      }
    }

    const matches: QuickOpenSearchItem[] = []
    for (const file of files) {
      const indices = this.fuzzyMatchQuickOpen(query, file.relativePath)
      if (!indices) continue

      const lowerRelativePath = file.relativePath.toLowerCase()
      const lowerFileName = file.name.toLowerCase()
      matches.push({
        path: file.path,
        relativePath: file.relativePath,
        fileName: file.name,
        score: this.fallbackQuickOpenScore(file.relativePath, indices),
        matchType: 'fallback',
        exactMatch: lowerRelativePath === normalizedQuery || lowerFileName === normalizedQuery,
      })
    }

    matches.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      return a.relativePath.localeCompare(b.relativePath)
    })

    return {
      state: 'ready',
      items: matches.slice(0, limit),
      totalMatched: matches.length,
      totalFiles: files.length,
      error,
    }
  }

  private static invalidateQuickOpenCachesForPath(targetPath: string): void {
    const normalizedTarget = toPosixPath(normalizeRootPath(targetPath))
    const rootsToRefresh = new Set<string>()

    for (const root of this.quickOpenFallbackFiles.keys()) {
      const normalizedRoot = toPosixPath(normalizeRootPath(root))
      if (normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + '/')) {
        this.quickOpenFallbackFiles.delete(root)
        rootsToRefresh.add(root)
      }
    }

    for (const root of this.quickOpenFinders.keys()) {
      const normalizedRoot = toPosixPath(normalizeRootPath(root))
      if (normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + '/')) {
        rootsToRefresh.add(root)
      }
    }

    for (const root of rootsToRefresh) {
      void this.refreshQuickOpenSearch(root)
    }
  }

  static async refreshQuickOpenSearch(worktreePath: string): Promise<void> {
    const normalizedPath = normalizeRootPath(worktreePath)
    this.quickOpenFallbackFiles.delete(normalizedPath)

    const finderPromise = this.quickOpenFinders.get(normalizedPath)
    if (!finderPromise) return

    try {
      const { finder } = await finderPromise
      const scan = finder.scanFiles()
      if (!scan.ok) {
        this.quickOpenFinders.delete(normalizedPath)
        return
      }

      const refresh = finder.refreshGitStatus()
      if (!refresh.ok) {
        this.quickOpenFinders.delete(normalizedPath)
      }
    } catch {
      this.quickOpenFinders.delete(normalizedPath)
    }
  }

  static disposeQuickOpenSearch(): void {
    const seen = new Set<Promise<QuickOpenFinderState>>()
    for (const promise of this.quickOpenFinders.values()) {
      if (seen.has(promise)) continue
      seen.add(promise)
      void promise.then(({ finder }) => finder.destroy()).catch(() => {})
    }
    this.quickOpenFinders.clear()
    this.quickOpenFallbackFiles.clear()
  }

  private static async getQuickOpenFinder(worktreePath: string): Promise<QuickOpenFinderState> {
    const normalizedPath = normalizeRootPath(worktreePath)
    const existing = this.quickOpenFinders.get(normalizedPath)
    if (existing) return existing

    const created = (async (): Promise<QuickOpenFinderState> => {
      const { FileFinder } = await loadFffNodeModule()
      if (!FileFinder.isAvailable()) {
        throw new Error('fff binary is not available on this machine')
      }

      FileFinder.ensureLoaded()
      const result = FileFinder.create({
        basePath: normalizedPath,
        aiMode: true,
      })
      if (!result.ok) {
        throw new Error(`Failed to initialize fff quick-open search: ${result.error}`)
      }

      const finder = result.value
      console.info('[quick-open] file indexing started', { worktreePath: normalizedPath })
      const ready = finder.waitForScan(5_000).then((waited) => {
        if (!waited.ok) throw new Error(waited.error)
      })

      return { finder, ready }
    })().catch((error) => {
      this.quickOpenFinders.delete(normalizedPath)
      throw error
    })

    this.quickOpenFinders.set(normalizedPath, created)
    return created
  }

  static async quickOpenSearch(worktreePath: string, request: QuickOpenSearchRequest): Promise<QuickOpenSearchResult> {
    const normalizedPath = normalizeRootPath(worktreePath)
    const query = request.query ?? ''
    const limit = Math.max(1, Math.min(request.limit ?? 50, 200))

    if (!query.trim()) {
      return this.fallbackQuickOpenSearch(normalizedPath, { ...request, limit })
    }

    try {
      const { finder, ready } = await this.getQuickOpenFinder(normalizedPath)
      const progress = finder.getScanProgress()
      if (progress.ok && progress.value.isScanning) {
        await Promise.race([
          ready,
          new Promise<void>((resolve) => setTimeout(resolve, 250)),
        ])
      }

      const search = finder.fileSearch(query, {
        pageSize: limit,
        currentFile: request.currentFile,
      })
      if (!search.ok) {
        throw new Error(search.error)
      }

      const nextProgress = finder.getScanProgress()
      const items: QuickOpenSearchItem[] = search.value.items.slice(0, limit).map((item, index) => ({
        path: item.path,
        relativePath: item.relativePath,
        fileName: item.fileName,
        gitStatus: item.gitStatus,
        score: quickOpenScoreTotal(search.value.scores[index]),
        matchType: search.value.scores[index]?.matchType,
        exactMatch: search.value.scores[index]?.exactMatch,
      }))

      return {
        state: nextProgress.ok && nextProgress.value.isScanning ? 'indexing' : 'ready',
        items,
        totalMatched: search.value.totalMatched,
        totalFiles: search.value.totalFiles,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Quick open search failed'
      return this.fallbackQuickOpenSearch(normalizedPath, { ...request, limit }, message)
    }
  }

  /** Collect `.md`/`.mdx` under `root/.cursor/plans`, `root/.claude/plans`, etc. */
  private static async collectPlanFilesUnderRoot(root: string, source: 'worktree' | 'home'): Promise<AgentPlanEntry[]> {
    const results: AgentPlanEntry[] = []

    const scanDir = async (dir: string, agent: string, depth: number) => {
      if (depth > 8) return
      let entries: import('fs').Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true }) as import('fs').Dirent[]
      } catch {
        return
      }
      for (const ent of entries) {
        const full = join(dir, ent.name as string)
        if (ent.isDirectory()) {
          await scanDir(full, agent, depth + 1)
        } else if (ent.isFile()) {
          const lower = full.toLowerCase()
          if (!lower.endsWith('.md') && !lower.endsWith('.mdx')) continue
          try {
            const fst = await stat(full)
            if (!fst.isFile()) continue
            const meta = await readPlanMetaPrefix(full)
            results.push({
              path: full,
              mtimeMs: fst.mtimeMs,
              agent,
              built: meta.built || undefined,
              codingAgent: meta.codingAgent,
              source,
            })
          } catch { /* race: deleted */ }
        }
      }
    }

    for (const rel of AGENT_PLAN_RELATIVE_DIRS) {
      const agent = PLAN_DIR_TO_AGENT[rel] ?? rel
      const dir = join(root, rel)
      try {
        const st = await stat(dir)
        if (!st.isDirectory()) continue
        await scanDir(dir, agent, 0)
      } catch { /* missing */ }
    }

    return results
  }

  private static dedupeWorktreePaths(paths: string[]): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const p of paths) {
      if (!p || typeof p !== 'string') continue
      const k = p.replace(/\/+$/, '') || '/'
      if (seen.has(k)) continue
      seen.add(k)
      out.push(p)
    }
    return out
  }

  /**
   * Find the most recently modified `.md` / `.mdx` under known agent plan folders
   * across one or more worktree roots (e.g. main project checkout plus linked worktrees),
   * merged with home agent plan dirs the same way as {@link listAgentPlanMarkdowns}.
   */
  static async findNewestPlanMarkdown(worktreePathOrPaths: string | string[]): Promise<string | null> {
    const all = await this.listAgentPlanMarkdowns(worktreePathOrPaths)
    return all[0]?.path ?? null
  }

  /**
   * All plan markdowns sorted newest-first, capped at 200.
   * Pass one or more worktree roots (same project); each entry includes `planSourceRoot`.
   * Home plan dirs (~/.cursor/plans, etc.) are merged once; workspace paths win on duplicate paths.
   */
  static async listAgentPlanMarkdowns(worktreePathOrPaths: string | string[]): Promise<AgentPlanEntry[]> {
    const raw = Array.isArray(worktreePathOrPaths) ? worktreePathOrPaths : [worktreePathOrPaths]
    const uniqueWts = this.dedupeWorktreePaths(raw.filter(Boolean))
    if (uniqueWts.length === 0) return []

    const byPath = new Map<string, AgentPlanEntry>()
    for (const wt of uniqueWts) {
      const fromWt = await this.collectPlanFilesUnderRoot(wt, 'worktree')
      for (const e of fromWt) {
        byPath.set(e.path, { ...e, planSourceRoot: wt })
      }
    }
    let fromHome: AgentPlanEntry[] = []
    try {
      fromHome = await this.collectPlanFilesUnderRoot(homedir(), 'home')
    } catch {
      /* ignore */
    }
    const homeRoot = homedir()
    for (const e of fromHome) {
      if (!byPath.has(e.path)) {
        byPath.set(e.path, { ...e, planSourceRoot: homeRoot })
      }
    }
    const all = [...byPath.values()]
    all.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return all.slice(0, 200)
  }

  /** Update constellagent-namespaced frontmatter on a plan file. */
  static async updatePlanMeta(filePath: string, patch: Partial<PlanMeta>): Promise<PlanMeta> {
    return writePlanMeta(filePath, patch)
  }

  /** Copy or move a plan to another agent's plan directory. Returns the new path. */
  static async relocateAgentPlan(
    worktreePath: string,
    filePath: string,
    targetAgent: PlanAgent,
    mode: 'copy' | 'move',
  ): Promise<string> {
    const inWorkspace = relativePathInWorktree(worktreePath, filePath) !== null
    const inHomeAgentDir = isAgentPlanPath('', filePath, homedir())
    if (!inWorkspace && !inHomeAgentDir) {
      throw new Error('Plan file is not inside the workspace or a supported home plan directory')
    }

    const targetRelDir = AGENT_TO_PLAN_DIR[targetAgent]
    if (!targetRelDir) throw new Error(`Unknown agent: ${targetAgent}`)

    const targetDir = join(worktreePath, targetRelDir)
    await mkdir(targetDir, { recursive: true })

    const name = basename(filePath)
    let dest = join(targetDir, name)

    // Handle name collision with incrementing suffix
    let attempt = 0
    while (true) {
      try {
        await stat(dest)
        attempt++
        const ext = name.lastIndexOf('.')
        const base = ext > 0 ? name.slice(0, ext) : name
        const suffix = ext > 0 ? name.slice(ext) : ''
        dest = join(targetDir, `${base}-${attempt}${suffix}`)
      } catch {
        break // doesn't exist — use this name
      }
    }

    if (mode === 'copy') {
      await copyFile(filePath, dest)
    } else {
      await copyFile(filePath, dest)
      await rm(filePath)
    }

    return dest
  }
}
