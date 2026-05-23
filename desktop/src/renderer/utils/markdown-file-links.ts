const EXTERNAL_PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:/i
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i
const FILE_EXT_PATTERN = String.raw`(?:tsx?|mjsx?|jsx?|css|json|mdx?|md|txt|csv|tsv|log|less|scss|html|svg|png|jpe?g|gif|webp|avif|rs|go|py|lock|toml|ya?ml|wasm|mjs|cjs|vue|svelte|mts|cts|ini|cfg|conf|env|patch|sql|proto|graphql|gql|gradle|kt|kts|swift|rb|php|dart|nix|zig|h|hpp|cc|cpp|cxx|cs|fs|fsx|scala|sbt|dockerignore|gitattributes|editorconfig)`
const FILE_EXT_RE = new RegExp(String.raw`\.${FILE_EXT_PATTERN}(?:[?#].*)?$`, 'i')
const BARE_FILE_REFERENCE_RE = new RegExp(
  String.raw`(^|[\s([{<>"'])((?:(?:\.{1,2}|~)?[\\/]|[A-Za-z]:[\\/])?(?:[A-Za-z0-9_@+.-]+[\\/])*[A-Za-z0-9_@+.-]+\.${FILE_EXT_PATTERN}(?::\d+(?::\d+)?)?(?:#[A-Za-z0-9_.:-]+)?)`,
  'gi',
)

export interface MarkdownFileTarget {
  href: string
  path: string
  absolutePath: string
  displayPath: string
  lineNumber?: number
}

export interface MarkdownFileReferenceRange {
  from: number
  to: number
  path: string
}

function stripWrappingAngles(value: string): string {
  return value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function filePathToFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const encoded = normalized
    .split('/')
    .map((part, index) => (index === 0 && part === '' ? '' : encodeURIComponent(part)))
    .join('/')
  return `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`
}

export function markdownBasename(path: string): string {
  const clean = path.replace(/\\/g, '/').replace(/[?#].*$/, '').replace(/\/$/, '')
  return clean.split('/').pop() || clean || path
}

export function markdownDirname(path: string | undefined): string | undefined {
  if (!path) return undefined
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index > 0 ? normalized.slice(0, index) : undefined
}

export function findMarkdownFileReferences(text: string): MarkdownFileReferenceRange[] {
  const ranges: MarkdownFileReferenceRange[] = []
  BARE_FILE_REFERENCE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = BARE_FILE_REFERENCE_RE.exec(text))) {
    const boundary = match[1] ?? ''
    const path = match[2]
    if (!path || !isLikelyMarkdownFilePath(path)) continue
    const from = match.index + boundary.length
    ranges.push({ from, to: from + path.length, path })
  }
  return ranges
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function joinPath(base: string, child: string): string {
  if (!base) return child
  const raw = `${base.replace(/\/+$/, '')}/${child.replace(/^\.\//, '').replace(/^\/+/, '')}`
  const absolute = raw.startsWith('/')
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `${absolute ? '/' : ''}${parts.join('/')}`
}

function parseLineFragment(fragment: string | undefined): number | undefined {
  if (!fragment) return undefined
  const match = fragment.match(/^(?:L|line-?|lines-?)?(\d+)$/i) ?? fragment.match(/^L(\d+)(?:[-:~]|$)/i)
  if (!match?.[1]) return undefined
  const line = Number.parseInt(match[1], 10)
  return Number.isFinite(line) && line > 0 ? line : undefined
}

function splitHref(href: string): { pathPart: string; fragment?: string; query?: string; lineNumber?: number } {
  const hashIndex = href.indexOf('#')
  const beforeHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href
  const fragment = hashIndex >= 0 ? href.slice(hashIndex + 1) : undefined
  const queryIndex = beforeHash.indexOf('?')
  const pathPart = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex) : undefined
  const suffix = pathPart.match(/^(.*?):(\d+)(?::\d+)?$/)
  if (suffix?.[1] && !/^[A-Za-z]$/.test(suffix[1])) {
    return { pathPart: suffix[1], fragment, query, lineNumber: Number.parseInt(suffix[2], 10) }
  }
  return { pathPart, fragment, query, lineNumber: parseLineFragment(fragment) }
}

function isExternalHref(href: string): boolean {
  if (!EXTERNAL_PROTOCOL_RE.test(href)) return false
  return !href.toLowerCase().startsWith('file:')
}

function isLikelyFilePath(path: string): boolean {
  if (!path || path.startsWith('#')) return false
  if (path.startsWith('/') || path.startsWith('./') || path.startsWith('../') || /^[A-Za-z]:[\\/]/.test(path)) return true
  return path.includes('/') || FILE_EXT_RE.test(path)
}

/** Whether a markdown path string should render as an inline file chip. */
export function isLikelyMarkdownFilePath(path: string): boolean {
  return isLikelyFilePath(path)
}

export function resolveMarkdownFileTarget(
  href: string | undefined,
  options: { baseDir?: string; worktreePath?: string } = {},
): MarkdownFileTarget | null {
  if (!href) return null
  const trimmed = stripWrappingAngles(href.trim())
  if (!trimmed || isExternalHref(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return null

  if (trimmed.toLowerCase().startsWith('file://')) {
    try {
      const url = new URL(trimmed)
      const absolutePath = safeDecodeURIComponent(url.pathname)
      if (!absolutePath) return null
      return {
        href: trimmed,
        path: absolutePath,
        absolutePath,
        displayPath: absolutePath,
        lineNumber: parseLineFragment(url.hash.replace(/^#/, '')),
      }
    } catch {
      return null
    }
  }

  const { pathPart, query, fragment, lineNumber } = splitHref(trimmed)
  const decodedPath = normalizeSlashes(safeDecodeURIComponent(pathPart))
  if (!isLikelyFilePath(decodedPath)) return null

  const base = decodedPath.startsWith('/') || /^[A-Za-z]:\//.test(decodedPath)
    ? undefined
    : options.baseDir ?? options.worktreePath
  const absolutePath = base ? joinPath(base, decodedPath) : decodedPath
  return {
    href: trimmed,
    path: `${decodedPath}${query ?? ''}${fragment ? `#${fragment}` : ''}`,
    absolutePath,
    displayPath: decodedPath,
    lineNumber,
  }
}

export function resolveMarkdownImageSrc(
  src: string | undefined,
  options: { baseDir?: string; worktreePath?: string } = {},
): string | undefined {
  if (!src) return src
  const trimmed = stripWrappingAngles(src.trim())
  if (!trimmed) return src
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || /^https?:/i.test(trimmed) || /^file:/i.test(trimmed)) {
    return trimmed
  }
  if (!IMAGE_EXT_RE.test(trimmed)) return trimmed
  const target = resolveMarkdownFileTarget(trimmed, options)
  return target ? filePathToFileUrl(target.absolutePath) : trimmed
}
