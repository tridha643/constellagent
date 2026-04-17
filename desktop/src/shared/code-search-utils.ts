import {
  DEFAULT_CODE_SEARCH_LIMIT,
  DEFAULT_CODE_SEARCH_MAX_FILE_SIZE_BYTES,
  DEFAULT_CODE_SEARCH_MAX_MATCHES_PER_FILE,
  DEFAULT_CODE_SEARCH_PREVIEW_CHARS,
  MAX_CODE_SEARCH_LIMIT,
  MAX_CODE_SEARCH_MAX_FILE_SIZE_BYTES,
  MAX_CODE_SEARCH_MAX_MATCHES_PER_FILE,
  type CodeSearchItem,
  type CodeSearchRequest,
  type CodeSearchScope,
} from './code-search-types'

const DEVELOPER_FILE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.cts', '.cjs', '.clj', '.cljs', '.coffee',
  '.dart', '.dockerfile', '.env', '.erb', '.fs', '.go', '.gradle', '.graphql', '.gql',
  '.groovy', '.h', '.hpp', '.html', '.ini', '.java', '.js', '.json', '.jsonc', '.jsx',
  '.kt', '.kts', '.less', '.lua', '.mjs', '.mts', '.php', '.pl', '.prisma', '.properties',
  '.proto', '.py', '.rb', '.rs', '.sass', '.scala', '.scss', '.sh', '.sql', '.svelte',
  '.swift', '.toml', '.ts', '.tsx', '.txttmpl', '.vue', '.xml', '.yaml', '.yml', '.zsh',
])

const DEVELOPER_FILE_NAMES = new Set([
  '.editorconfig',
  '.eslintignore',
  '.eslintrc',
  '.gitattributes',
  '.gitignore',
  '.gitmodules',
  '.npmrc',
  '.nvmrc',
  '.prettierignore',
  '.prettierrc',
  '.tool-versions',
  'babel.config.js',
  'babel.config.cjs',
  'build',
  'build.bazel',
  'cmakelists.txt',
  'codeowners',
  'dockerfile',
  'gemfile',
  'justfile',
  'makefile',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'procfile',
  'requirements.txt',
  'tsconfig.json',
  'turbo.json',
  'vite.config.ts',
  'webpack.config.js',
  'workspace',
  'yarn.lock',
])

const DEVELOPER_FILE_PREFIXES = [
  '.env',
  '.eslintrc.',
  '.prettierrc.',
  '.babelrc',
  '.stylelintrc',
]

const PROSE_DIRECTORY_NAMES = new Set([
  'docs',
  'doc',
  'documentation',
])

const PROSE_FILE_BASENAMES = new Set([
  'changelog',
  'contributing',
  'license',
  'readme',
])

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

export function normalizeCodeSearchScope(scope?: CodeSearchScope): CodeSearchScope {
  return scope ?? { kind: 'workspace' }
}

export function clampCodeSearchLimit(limit?: number): number {
  return Math.max(1, Math.min(limit ?? DEFAULT_CODE_SEARCH_LIMIT, MAX_CODE_SEARCH_LIMIT))
}

export function clampCodeSearchMaxMatchesPerFile(maxMatchesPerFile?: number): number {
  return Math.max(1, Math.min(maxMatchesPerFile ?? DEFAULT_CODE_SEARCH_MAX_MATCHES_PER_FILE, MAX_CODE_SEARCH_MAX_MATCHES_PER_FILE))
}

export function clampCodeSearchMaxFileSizeBytes(maxFileSizeBytes?: number): number {
  return Math.max(1_024, Math.min(maxFileSizeBytes ?? DEFAULT_CODE_SEARCH_MAX_FILE_SIZE_BYTES, MAX_CODE_SEARCH_MAX_FILE_SIZE_BYTES))
}

export function isDeveloperCodeSearchPath(relativePath: string): boolean {
  const normalized = normalizePath(relativePath).replace(/^\//, '')
  if (!normalized) return false

  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0) return false

  const fileName = segments[segments.length - 1]!
  const lowerFileName = fileName.toLowerCase()
  const lowerSegments = segments.map((segment) => segment.toLowerCase())

  if (lowerSegments.slice(0, -1).some((segment) => PROSE_DIRECTORY_NAMES.has(segment))) {
    return false
  }

  const bareName = lowerFileName.includes('.')
    ? lowerFileName.slice(0, lowerFileName.indexOf('.'))
    : lowerFileName
  if (PROSE_FILE_BASENAMES.has(bareName)) {
    return false
  }

  if (DEVELOPER_FILE_NAMES.has(lowerFileName)) return true
  if (DEVELOPER_FILE_PREFIXES.some((prefix) => lowerFileName === prefix || lowerFileName.startsWith(prefix))) {
    return true
  }

  const extensionIndex = lowerFileName.lastIndexOf('.')
  if (extensionIndex < 0) return false

  return DEVELOPER_FILE_EXTENSIONS.has(lowerFileName.slice(extensionIndex))
}

export function buildCodeSearchPreview(
  lineContent: string,
  matchRanges: ReadonlyArray<readonly [number, number]> | undefined,
  maxChars = DEFAULT_CODE_SEARCH_PREVIEW_CHARS,
): { preview: string; matchRanges: Array<[number, number]>; previewTruncated: boolean } {
  if (lineContent.length <= maxChars) {
    return {
      preview: lineContent,
      matchRanges: (matchRanges ?? []).map(([start, end]) => [start, end]),
      previewTruncated: false,
    }
  }

  const firstMatchStart = matchRanges?.[0]?.[0] ?? 0
  const desiredStart = Math.max(0, firstMatchStart - Math.floor(maxChars * 0.35))
  let sliceStart = desiredStart
  let sliceEnd = Math.min(lineContent.length, sliceStart + maxChars)

  if (sliceEnd - sliceStart < maxChars) {
    sliceStart = Math.max(0, sliceEnd - maxChars)
  }

  const prefix = sliceStart > 0 ? '…' : ''
  const suffix = sliceEnd < lineContent.length ? '…' : ''
  const sliced = lineContent.slice(sliceStart, sliceEnd)
  const preview = `${prefix}${sliced}${suffix}`
  const adjustedMatchRanges: Array<[number, number]> = []

  for (const [rawStart, rawEnd] of matchRanges ?? []) {
    const start = Math.max(rawStart, sliceStart)
    const end = Math.min(rawEnd, sliceEnd)
    if (end <= start) continue
    adjustedMatchRanges.push([
      start - sliceStart + prefix.length,
      end - sliceStart + prefix.length,
    ])
  }

  return {
    preview,
    matchRanges: adjustedMatchRanges,
    previewTruncated: true,
  }
}

export function sortAndCapCodeSearchItems<T extends Pick<CodeSearchItem, 'path' | 'relativePath' | 'lineNumber' | 'column'>>(
  items: readonly T[],
  options: {
    limit: number
    maxMatchesPerFile: number
    preferredPathOrder?: readonly string[]
  },
): { items: T[]; totalMatched: number; hasMore: boolean } {
  const normalizedPreferredOrder = new Map<string, number>()
  for (const [index, pathValue] of (options.preferredPathOrder ?? []).entries()) {
    const normalized = normalizePath(pathValue)
    if (!normalizedPreferredOrder.has(normalized)) normalizedPreferredOrder.set(normalized, index)
  }

  const sorted = [...items].sort((left, right) => {
    const leftRank = normalizedPreferredOrder.get(normalizePath(left.path)) ?? Number.MAX_SAFE_INTEGER
    const rightRank = normalizedPreferredOrder.get(normalizePath(right.path)) ?? Number.MAX_SAFE_INTEGER
    if (leftRank !== rightRank) return leftRank - rightRank

    const pathCompare = left.relativePath.localeCompare(right.relativePath)
    if (pathCompare !== 0) return pathCompare
    if (left.lineNumber !== right.lineNumber) return left.lineNumber - right.lineNumber
    return left.column - right.column
  })

  const perFileCounts = new Map<string, number>()
  const kept: T[] = []
  let totalMatched = 0

  for (const item of sorted) {
    const key = normalizePath(item.path)
    const count = perFileCounts.get(key) ?? 0
    if (count >= options.maxMatchesPerFile) continue
    perFileCounts.set(key, count + 1)
    totalMatched += 1
    if (kept.length < options.limit) kept.push(item)
  }

  return {
    items: kept,
    totalMatched: kept.length,
    hasMore: totalMatched > kept.length,
  }
}

export interface PreparedCodeSearchRequest {
  query: string
  scope: CodeSearchScope
  limit: number
  maxMatchesPerFile: number
  maxFileSizeBytes: number
  mode: NonNullable<CodeSearchRequest['mode']>
}

export function prepareCodeSearchRequest(request: CodeSearchRequest): PreparedCodeSearchRequest {
  return {
    query: request.query ?? '',
    scope: normalizeCodeSearchScope(request.scope),
    limit: clampCodeSearchLimit(request.limit),
    maxMatchesPerFile: clampCodeSearchMaxMatchesPerFile(request.maxMatchesPerFile),
    maxFileSizeBytes: clampCodeSearchMaxFileSizeBytes(request.maxFileSizeBytes),
    mode: request.mode === 'regex' ? 'regex' : 'plain',
  }
}
