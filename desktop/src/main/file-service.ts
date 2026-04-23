import { readdir, readFile as fsReadFile, writeFile as fsWriteFile, stat, rm, copyFile, mkdir, realpath } from 'fs/promises'
import { homedir } from 'os'
import { join, basename, relative, dirname } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { FileFinder as FileFinderType, GrepCursor } from '@ff-labs/fff-node'
import {
  AGENT_PLAN_RELATIVE_DIRS,
  PLAN_DIR_TO_AGENT,
  AGENT_TO_PLAN_DIR,
  isAgentPlanPath,
  relativePathInWorktree,
} from '../shared/agent-plan-path'
import type { CodeSearchItem, CodeSearchRequest, CodeSearchResult } from '../shared/code-search-types'
import {
  buildCodeSearchPreview,
  isDeveloperCodeSearchPath,
  prepareCodeSearchRequest,
  sortAndCapCodeSearchItems,
} from '../shared/code-search-utils'
import type {
  AgentPlanEntry,
  AgentPlanSearchItem,
  AgentPlanSearchRequest,
  AgentPlanSearchResult,
  PlanAgent,
  PlanMeta,
} from '../shared/agent-plan-path'
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

function resolveFffAbsolutePath(basePath: string, relativePath: string): string {
  const normalizedRelativePath = toPosixPath(relativePath)
  return normalizedRelativePath ? join(basePath, normalizedRelativePath) : basePath
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

interface CodeSearchFallbackFile {
  name: string
  path: string
  relativePath: string
}

interface PlanSearchRoot {
  searchRoot: string
  sourceRoot: string
  source: 'worktree' | 'home'
  agent: string
}

function isMarkdownPlanPath(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.mdx')
}

function relativePlanPath(sourceRoot: string, filePath: string): string {
  if (!sourceRoot) return basename(filePath)
  const rel = toPosixPath(relative(sourceRoot, filePath))
  return rel && rel !== '.' ? rel : basename(filePath)
}

export class FileService {
  private static quickOpenFinders = new Map<string, Promise<QuickOpenFinderState>>()
  private static quickOpenFallbackFiles = new Map<string, Promise<QuickOpenFallbackFile[]>>()
  private static codeSearchFallbackFiles = new Map<string, Promise<CodeSearchFallbackFile[]>>()

  /** Canonical filesystem root for a workspace (symlink-safe). Used by IPC + tree. */
  static async normalizeFsRoot(dirPath: string): Promise<string> {
    const trimmed = normalizeRootPath(dirPath)
    try {
      return normalizeRootPath(await realpath(trimmed))
    } catch {
      return trimmed
    }
  }

  static async getTree(dirPath: string, depth = 0): Promise<FileNode[]> {
    if (depth > 8) return [] // prevent infinite recursion

    const effectiveDir = depth === 0 ? await this.normalizeFsRoot(dirPath) : dirPath

    // Use git ls-files if in a git repo for gitignore respect
    if (depth === 0) {
      try {
        return await this.getGitTree(effectiveDir)
      } catch {
        // Fall back to manual traversal
      }
    }

    const entries = await readdir(effectiveDir, { withFileTypes: true })
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
      const fullPath = join(effectiveDir, entry.name)
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
    const cwd = normalizeRootPath(dirPath)

    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], {
        cwd,
        maxBuffer: 1024 * 1024,
      })
    } catch {
      throw new Error('not a git repository')
    }

    /** Paths from ls-files are repo-root-relative; strip this to get cwd-relative segments. */
    let subPrefix = ''
    try {
      const { stdout: prefixOut } = await execFileAsync('git', ['rev-parse', '--show-prefix'], {
        cwd,
        maxBuffer: 1024 * 1024,
      })
      const raw = prefixOut.trim()
      subPrefix = raw ? toPosixPath(raw.replace(/\/+$/, '')) : ''
    } catch {
      subPrefix = ''
    }

    const [{ stdout }, alwaysVisibleFiles] = await Promise.all([
      execFileAsync('git', ['ls-files', '--others', '--cached', '--exclude-standard'], {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
      }),
      this.collectAlwaysVisibleFiles(cwd),
    ])

    const rawLines = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => toPosixPath(line))

    let relForTree: string[]
    if (!subPrefix) {
      relForTree = rawLines
    } else {
      const stripped = rawLines.flatMap((line) => {
        if (line === subPrefix) return []
        if (line.startsWith(`${subPrefix}/`)) {
          return [line.slice(subPrefix.length + 1)]
        }
        return []
      })
      // If git reports paths cwd-relative (some setups) stripping removes everything — fall back.
      relForTree = stripped.length > 0 ? stripped : rawLines
    }

    return this.buildTreeFromPaths(cwd, [...relForTree, ...alwaysVisibleFiles])
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
    const parent = dirname(filePath)
    if (parent && parent !== filePath) {
      await mkdir(parent, { recursive: true })
    }
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

  private static async collectCodeSearchFallbackRelativePaths(
    basePath: string,
    relativeDir = '',
    depth = 0,
  ): Promise<string[]> {
    if (depth > 16) return []

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
        files.push(...await this.collectCodeSearchFallbackRelativePaths(basePath, nextRelativePath, depth + 1))
        continue
      }

      if (entry.isFile()) {
        files.push(toPosixPath(nextRelativePath))
      }
    }

    return files
  }

  private static async getCodeSearchFallbackFiles(worktreePath: string): Promise<CodeSearchFallbackFile[]> {
    const normalizedPath = normalizeRootPath(worktreePath)
    const existing = this.codeSearchFallbackFiles.get(normalizedPath)
    if (existing) return existing

    const created = (async () => {
      let relativePaths: string[] = []
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['ls-files', '--others', '--cached', '--exclude-standard'],
          { cwd: normalizedPath },
        )
        relativePaths = stdout
          .split('\n')
          .map((value) => toPosixPath(value.trim()))
          .filter(Boolean)
      } catch {
        relativePaths = await this.collectCodeSearchFallbackRelativePaths(normalizedPath)
      }

      const unique = [...new Set(relativePaths)].sort((left, right) => left.localeCompare(right))
      return unique.map((relativePath) => ({
        name: basename(relativePath),
        path: join(normalizedPath, relativePath),
        relativePath,
      }))
    })().catch((error) => {
      this.codeSearchFallbackFiles.delete(normalizedPath)
      throw error
    })

    this.codeSearchFallbackFiles.set(normalizedPath, created)
    return created
  }

  private static async resolveCodeSearchScopeFiles(
    worktreePath: string,
    scope: CodeSearchRequest['scope'],
  ): Promise<{ files: CodeSearchFallbackFile[]; preferredPathOrder?: string[] }> {
    const files = await this.getCodeSearchFallbackFiles(worktreePath)
    const fileByRelativePath = new Map(files.map((file) => [file.relativePath, file]))

    if (!scope || scope.kind === 'workspace') {
      return {
        files: files.filter((file) => isDeveloperCodeSearchPath(file.relativePath)),
      }
    }

    const requestedPaths = scope.kind === 'activeFile' ? [scope.filePath] : scope.filePaths
    const resolved: CodeSearchFallbackFile[] = []
    const seen = new Set<string>()

    for (const filePath of requestedPaths) {
      const relativePath = relativePathInWorktree(worktreePath, filePath)
      if (relativePath == null || relativePath === '') continue
      const normalizedRelativePath = toPosixPath(relativePath)
      if (!isDeveloperCodeSearchPath(normalizedRelativePath) || seen.has(normalizedRelativePath)) continue
      seen.add(normalizedRelativePath)
      const existing = fileByRelativePath.get(normalizedRelativePath)
      resolved.push(existing ?? {
        name: basename(normalizedRelativePath),
        path: join(worktreePath, normalizedRelativePath),
        relativePath: normalizedRelativePath,
      })
    }

    return {
      files: resolved,
      preferredPathOrder: resolved.map((file) => file.path),
    }
  }

  private static toCodeSearchItem(match: {
    relativePath: string
    fileName: string
    gitStatus?: string
    lineNumber: number
    col: number
    lineContent: string
    matchRanges: [number, number][]
  }, basePath: string): CodeSearchItem {
    const preview = buildCodeSearchPreview(match.lineContent, match.matchRanges)
    return {
      path: resolveFffAbsolutePath(basePath, match.relativePath),
      relativePath: toPosixPath(match.relativePath),
      fileName: match.fileName,
      gitStatus: match.gitStatus,
      lineNumber: match.lineNumber,
      column: match.col + 1,
      preview: preview.preview,
      matchRanges: preview.matchRanges,
      previewTruncated: preview.previewTruncated,
    }
  }

  private static async runWorkspaceCodeSearchWithFff(
    finder: FileFinderType,
    basePath: string,
    request: ReturnType<typeof prepareCodeSearchRequest>,
    scopeFiles: CodeSearchFallbackFile[],
  ): Promise<Omit<CodeSearchResult, 'state' | 'error' | 'candidateFileCount'>> {
    const scopeRelativePaths = new Set(scopeFiles.map((file) => file.relativePath))
    const rawItems: CodeSearchItem[] = []
    let searchedFileCount = 0
    let regexFallbackError: string | undefined
    let cursor: GrepCursor | null = null
    let hasMore = false

    for (let page = 0; page < 12; page += 1) {
      const search: ReturnType<FileFinderType['grep']> = request.mode === 'regex'
        ? finder.grep(request.query, {
            cursor,
            mode: 'regex',
            maxFileSize: request.maxFileSizeBytes,
            maxMatchesPerFile: request.maxMatchesPerFile,
          })
        : finder.multiGrep({
            patterns: [request.query],
            cursor,
            maxFileSize: request.maxFileSizeBytes,
            maxMatchesPerFile: request.maxMatchesPerFile,
          })

      if (!search.ok) {
        throw new Error(search.error)
      }

      searchedFileCount += search.value.totalFilesSearched
      regexFallbackError ??= search.value.regexFallbackError

      for (const match of search.value.items) {
        if (!scopeRelativePaths.has(toPosixPath(match.relativePath))) continue
        rawItems.push(this.toCodeSearchItem(match, basePath))
      }

      if (rawItems.length > request.limit) {
        hasMore = true
        break
      }

      cursor = search.value.nextCursor
      if (!cursor) break
      hasMore = true
    }

    const capped = sortAndCapCodeSearchItems(rawItems, {
      limit: request.limit,
      maxMatchesPerFile: request.maxMatchesPerFile,
    })

    return {
      items: capped.items,
      totalMatched: capped.totalMatched,
      searchedFileCount,
      hasMore: capped.hasMore || hasMore,
      regexFallbackError,
    }
  }

  private static async runExplicitCodeSearchWithFff(
    finder: FileFinderType,
    basePath: string,
    request: ReturnType<typeof prepareCodeSearchRequest>,
    scopeFiles: CodeSearchFallbackFile[],
    preferredPathOrder: string[],
  ): Promise<Omit<CodeSearchResult, 'state' | 'error' | 'candidateFileCount'>> {
    const rawItems: CodeSearchItem[] = []
    let searchedFileCount = 0
    let regexFallbackError: string | undefined

    for (const file of scopeFiles) {
      if (rawItems.length > request.limit) break

      if (file.relativePath.includes(' ')) {
        const fallback = await this.fallbackSearchFile(file, request)
        searchedFileCount += fallback.searchedFileCount
        regexFallbackError ??= fallback.regexFallbackError
        rawItems.push(...fallback.items)
        continue
      }

      const constrainedQuery = `${file.relativePath} ${request.query}`
      const search = finder.grep(constrainedQuery, {
        mode: request.mode,
        maxFileSize: request.maxFileSizeBytes,
        maxMatchesPerFile: request.maxMatchesPerFile,
      })
      if (!search.ok) {
        throw new Error(search.error)
      }

      searchedFileCount += search.value.totalFilesSearched
      regexFallbackError ??= search.value.regexFallbackError
      rawItems.push(...search.value.items.map((match) => this.toCodeSearchItem(match, basePath)))
    }

    const capped = sortAndCapCodeSearchItems(rawItems, {
      limit: request.limit,
      maxMatchesPerFile: request.maxMatchesPerFile,
      preferredPathOrder,
    })

    return {
      items: capped.items,
      totalMatched: capped.totalMatched,
      searchedFileCount,
      hasMore: capped.hasMore,
      regexFallbackError,
    }
  }

  private static fallbackLineMatchRanges(
    lineContent: string,
    query: string,
    mode: ReturnType<typeof prepareCodeSearchRequest>['mode'],
  ): { matchRanges: Array<[number, number]>; regexFallbackError?: string } {
    if (!query) {
      return { matchRanges: [] }
    }

    const caseInsensitive = query === query.toLowerCase()
    const collectPlainMatches = () => {
      const haystack = caseInsensitive ? lineContent.toLowerCase() : lineContent
      const needle = caseInsensitive ? query.toLowerCase() : query
      const matchRanges: Array<[number, number]> = []
      let startIndex = 0

      while (needle && startIndex <= haystack.length) {
        const foundIndex = haystack.indexOf(needle, startIndex)
        if (foundIndex < 0) break
        matchRanges.push([foundIndex, foundIndex + needle.length])
        startIndex = foundIndex + Math.max(needle.length, 1)
      }

      return matchRanges
    }

    if (mode !== 'regex') {
      return { matchRanges: collectPlainMatches() }
    }

    try {
      const flags = caseInsensitive ? 'gi' : 'g'
      const regex = new RegExp(query, flags)
      const matchRanges: Array<[number, number]> = []
      let match: RegExpExecArray | null
      while ((match = regex.exec(lineContent)) !== null) {
        const value = match[0] ?? ''
        matchRanges.push([match.index, match.index + value.length])
        if (value.length === 0) regex.lastIndex += 1
      }
      return { matchRanges }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid regular expression'
      return {
        matchRanges: collectPlainMatches(),
        regexFallbackError: message,
      }
    }
  }

  private static async fallbackSearchFile(
    file: CodeSearchFallbackFile,
    request: ReturnType<typeof prepareCodeSearchRequest>,
  ): Promise<{ items: CodeSearchItem[]; searchedFileCount: number; regexFallbackError?: string }> {
    try {
      const info = await stat(file.path)
      if (!info.isFile() || info.size > request.maxFileSizeBytes) {
        return { items: [], searchedFileCount: 0 }
      }
    } catch {
      return { items: [], searchedFileCount: 0 }
    }

    let content: string
    try {
      content = await fsReadFile(file.path, 'utf-8')
    } catch {
      return { items: [], searchedFileCount: 0 }
    }

    const items: CodeSearchItem[] = []
    const lines = content.split(/\r?\n/)
    let regexFallbackError: string | undefined

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      const match = this.fallbackLineMatchRanges(line, request.query, request.mode)
      regexFallbackError ??= match.regexFallbackError
      if (match.matchRanges.length === 0) continue
      const preview = buildCodeSearchPreview(line, match.matchRanges)
      items.push({
        path: file.path,
        relativePath: file.relativePath,
        fileName: file.name,
        lineNumber: index + 1,
        column: match.matchRanges[0]?.[0] != null ? match.matchRanges[0][0] + 1 : 1,
        preview: preview.preview,
        matchRanges: preview.matchRanges,
        previewTruncated: preview.previewTruncated,
      })
      if (items.length >= request.maxMatchesPerFile) break
    }

    return {
      items,
      searchedFileCount: 1,
      regexFallbackError,
    }
  }

  private static async fallbackCodeSearch(
    worktreePath: string,
    request: ReturnType<typeof prepareCodeSearchRequest>,
    error?: string,
  ): Promise<CodeSearchResult> {
    const scope = await this.resolveCodeSearchScopeFiles(worktreePath, request.scope)
    const rawItems: CodeSearchItem[] = []
    let searchedFileCount = 0
    let regexFallbackError: string | undefined

    for (const file of scope.files) {
      if (rawItems.length > request.limit) break
      const fileResult = await this.fallbackSearchFile(file, request)
      searchedFileCount += fileResult.searchedFileCount
      regexFallbackError ??= fileResult.regexFallbackError
      rawItems.push(...fileResult.items)
    }

    const capped = sortAndCapCodeSearchItems(rawItems, {
      limit: request.limit,
      maxMatchesPerFile: request.maxMatchesPerFile,
      preferredPathOrder: scope.preferredPathOrder,
    })

    return {
      state: 'ready',
      items: capped.items,
      totalMatched: capped.totalMatched,
      candidateFileCount: scope.files.length,
      searchedFileCount,
      hasMore: capped.hasMore,
      error,
      regexFallbackError,
    }
  }

  static async codeSearch(worktreePath: string, request: CodeSearchRequest): Promise<CodeSearchResult> {
    const normalizedPath = normalizeRootPath(worktreePath)
    const preparedRequest = prepareCodeSearchRequest(request)
    if (!preparedRequest.query.trim()) {
      return {
        state: 'ready',
        items: [],
        totalMatched: 0,
        candidateFileCount: 0,
        searchedFileCount: 0,
        hasMore: false,
      }
    }

    try {
      const scope = await this.resolveCodeSearchScopeFiles(normalizedPath, preparedRequest.scope)
      if (scope.files.length === 0) {
        return {
          state: 'ready',
          items: [],
          totalMatched: 0,
          candidateFileCount: 0,
          searchedFileCount: 0,
          hasMore: false,
        }
      }

      const { finder, ready } = await this.getQuickOpenFinder(normalizedPath)
      const progress = finder.getScanProgress()
      if (progress.ok && progress.value.isScanning) {
        await Promise.race([
          ready,
          new Promise<void>((resolve) => setTimeout(resolve, 250)),
        ])
      }

      const result = scope.preferredPathOrder
        ? await this.runExplicitCodeSearchWithFff(
            finder,
            normalizedPath,
            preparedRequest,
            scope.files,
            scope.preferredPathOrder,
          )
        : await this.runWorkspaceCodeSearchWithFff(finder, normalizedPath, preparedRequest, scope.files)

      const nextProgress = finder.getScanProgress()
      return {
        state: nextProgress.ok && nextProgress.value.isScanning ? 'indexing' : 'ready',
        candidateFileCount: scope.files.length,
        ...result,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Code search failed'
      try {
        return await this.fallbackCodeSearch(normalizedPath, preparedRequest, message)
      } catch {
        return {
          state: 'error',
          items: [],
          totalMatched: 0,
          candidateFileCount: 0,
          searchedFileCount: 0,
          hasMore: false,
          error: message,
        }
      }
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

    for (const root of this.codeSearchFallbackFiles.keys()) {
      const normalizedRoot = toPosixPath(normalizeRootPath(root))
      if (normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + '/')) {
        this.codeSearchFallbackFiles.delete(root)
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
    this.codeSearchFallbackFiles.delete(normalizedPath)

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
    this.codeSearchFallbackFiles.clear()
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
        path: resolveFffAbsolutePath(normalizedPath, item.relativePath),
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

  private static async getExistingPlanSearchRoots(worktreePathOrPaths: string | string[]): Promise<PlanSearchRoot[]> {
    const roots: PlanSearchRoot[] = []
    const seen = new Set<string>()
    const raw = Array.isArray(worktreePathOrPaths) ? worktreePathOrPaths : [worktreePathOrPaths]
    const uniqueWts = this.dedupeWorktreePaths(raw.filter(Boolean))
    if (uniqueWts.length === 0) return roots

    const pushIfExists = async (sourceRoot: string, source: 'worktree' | 'home') => {
      for (const relDir of AGENT_PLAN_RELATIVE_DIRS) {
        const searchRoot = join(sourceRoot, relDir)
        const normalizedSearchRoot = normalizeRootPath(searchRoot)
        if (seen.has(normalizedSearchRoot)) continue
        try {
          const st = await stat(searchRoot)
          if (!st.isDirectory()) continue
          seen.add(normalizedSearchRoot)
          roots.push({
            searchRoot,
            sourceRoot,
            source,
            agent: PLAN_DIR_TO_AGENT[relDir] ?? relDir,
          })
        } catch {
          /* missing */
        }
      }
    }

    for (const wt of uniqueWts) {
      await pushIfExists(wt, 'worktree')
    }

    try {
      await pushIfExists(homedir(), 'home')
    } catch {
      /* ignore */
    }

    return roots
  }

  private static async buildPlanSearchItem(
    path: string,
    agent: string,
    source: 'worktree' | 'home',
    sourceRoot: string,
    score: number,
    matchType?: string,
    exactMatch?: boolean,
  ): Promise<AgentPlanSearchItem | null> {
    if (!isMarkdownPlanPath(path)) return null
    try {
      const fst = await stat(path)
      if (!fst.isFile()) return null
      const meta = await readPlanMetaPrefix(path)
      return {
        path,
        relativePath: relativePlanPath(sourceRoot, path),
        fileName: basename(path),
        mtimeMs: fst.mtimeMs,
        agent,
        built: meta.built || undefined,
        codingAgent: meta.codingAgent,
        source,
        planSourceRoot: sourceRoot,
        score,
        matchType,
        exactMatch,
      }
    } catch {
      return null
    }
  }

  private static fallbackPlanSearchScore(relativePath: string, indices: number[]): number {
    const nameStart = relativePath.lastIndexOf('/') + 1
    const nameMatchCount = indices.filter((i) => i >= nameStart).length
    return nameMatchCount * 10 - indices.length - relativePath.length
  }

  private static async fallbackAgentPlanSearch(
    worktreePathOrPaths: string | string[],
    request: AgentPlanSearchRequest,
    error?: string,
  ): Promise<AgentPlanSearchResult> {
    const query = request.query ?? ''
    const normalizedQuery = query.trim().toLowerCase()
    const limit = Math.max(1, Math.min(request.limit ?? 200, 200))
    const plans = await this.listAgentPlanMarkdowns(worktreePathOrPaths)

    if (!normalizedQuery) {
      return {
        state: error ? 'error' : 'ready',
        items: plans.slice(0, limit).map((plan) => ({
          ...plan,
          relativePath: relativePlanPath(plan.planSourceRoot ?? '', plan.path),
          fileName: basename(plan.path),
          score: 0,
          matchType: 'fallback',
        })),
        totalMatched: plans.length,
        totalFiles: plans.length,
        error,
      }
    }

    const matches: AgentPlanSearchItem[] = []
    for (const plan of plans) {
      const relativePath = relativePlanPath(plan.planSourceRoot ?? '', plan.path)
      const indices = this.fuzzyMatchQuickOpen(query, relativePath)
      if (!indices) continue
      const lowerRelativePath = relativePath.toLowerCase()
      const lowerFileName = basename(plan.path).toLowerCase()
      matches.push({
        ...plan,
        relativePath,
        fileName: basename(plan.path),
        score: this.fallbackPlanSearchScore(relativePath, indices),
        matchType: 'fallback',
        exactMatch: lowerRelativePath === normalizedQuery || lowerFileName === normalizedQuery,
      })
    }

    matches.sort((a, b) => {
      if (a.exactMatch !== b.exactMatch) return a.exactMatch ? -1 : 1
      if (a.score !== b.score) return b.score - a.score
      if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs
      return a.relativePath.localeCompare(b.relativePath)
    })

    return {
      state: error ? 'error' : 'ready',
      items: matches.slice(0, limit),
      totalMatched: matches.length,
      totalFiles: plans.length,
      error,
    }
  }

  static async searchAgentPlanMarkdowns(
    worktreePathOrPaths: string | string[],
    request: AgentPlanSearchRequest,
  ): Promise<AgentPlanSearchResult> {
    const query = request.query ?? ''
    const limit = Math.max(1, Math.min(request.limit ?? 200, 200))

    if (!query.trim()) {
      return this.fallbackAgentPlanSearch(worktreePathOrPaths, { ...request, limit })
    }

    const roots = await this.getExistingPlanSearchRoots(worktreePathOrPaths)
    if (roots.length === 0) {
      return {
        state: 'ready',
        items: [],
        totalMatched: 0,
        totalFiles: 0,
      }
    }

    const pageSize = Math.max(limit * 4, 80)
    const deduped = new Map<string, AgentPlanSearchItem>()
    let anyIndexing = false
    let totalFiles = 0
    const errors: string[] = []

    await Promise.all(roots.map(async (root) => {
      try {
        const { finder, ready } = await this.getQuickOpenFinder(root.searchRoot)
        const progress = finder.getScanProgress()
        if (progress.ok && progress.value.isScanning) {
          anyIndexing = true
          await Promise.race([
            ready,
            new Promise<void>((resolve) => setTimeout(resolve, 250)),
          ])
        }

        const search = finder.fileSearch(query, { pageSize })
        if (!search.ok) {
          throw new Error(search.error)
        }

        const nextProgress = finder.getScanProgress()
        if (nextProgress.ok && nextProgress.value.isScanning) anyIndexing = true
        totalFiles += search.value.totalFiles

        const builtItems = await Promise.all(search.value.items.map((item, index) => {
          const score = search.value.scores[index]
          return this.buildPlanSearchItem(
            resolveFffAbsolutePath(root.searchRoot, item.relativePath),
            root.agent,
            root.source,
            root.sourceRoot,
            quickOpenScoreTotal(score),
            score?.matchType,
            score?.exactMatch,
          )
        }))

        for (const item of builtItems) {
          if (!item) continue
          const existing = deduped.get(item.path)
          if (!existing) {
            deduped.set(item.path, item)
            continue
          }
          if (item.exactMatch && !existing.exactMatch) {
            deduped.set(item.path, item)
            continue
          }
          if ((item.score ?? 0) > (existing.score ?? 0)) {
            deduped.set(item.path, item)
            continue
          }
          if (item.score === existing.score && item.mtimeMs > existing.mtimeMs) {
            deduped.set(item.path, item)
          }
        }
      } catch (searchError) {
        errors.push(searchError instanceof Error ? searchError.message : 'Plan search failed')
      }
    }))

    if (deduped.size === 0 && errors.length > 0) {
      return this.fallbackAgentPlanSearch(worktreePathOrPaths, { ...request, limit }, errors[0])
    }

    const items = [...deduped.values()]
    items.sort((a, b) => {
      if (a.exactMatch !== b.exactMatch) return a.exactMatch ? -1 : 1
      if (a.score !== b.score) return b.score - a.score
      if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs
      return a.relativePath.localeCompare(b.relativePath)
    })

    return {
      state: errors.length > 0 && items.length === 0
        ? 'error'
        : anyIndexing
          ? 'indexing'
          : 'ready',
      items: items.slice(0, limit),
      totalMatched: items.length,
      totalFiles,
      error: errors[0],
    }
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
