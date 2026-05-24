const FILE_EXT_RE = /\.[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/

function isLikelyFilePathLine(line: string): boolean {
  const path = line.trim()
  if (!path || path.startsWith('#')) return false
  if (path.startsWith('/') || path.startsWith('./') || path.startsWith('../') || /^[A-Za-z]:[\\/]/.test(path)) {
    return true
  }
  return path.includes('/') || FILE_EXT_RE.test(path)
}

/** Split text into non-empty trimmed lines. */
export function splitFilePathListLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * Returns repo-relative file paths when `text` looks like a newline-separated
 * path list (at least two lines, all lines are likely file paths).
 */
export function parseFilePathListText(text: string): string[] | null {
  const lines = splitFilePathListLines(text)
  if (lines.length < 2) return null
  if (!lines.every(isLikelyFilePathLine)) return null
  return lines
}

/** Fenced-code info strings that should never render as a file path list. */
const BLOCKED_FENCE_LANGS = new Set([
  'mermaid',
  'bash',
  'sh',
  'shell',
  'zsh',
  'javascript',
  'js',
  'typescript',
  'ts',
  'tsx',
  'jsx',
  'json',
  'yaml',
  'yml',
  'sql',
  'html',
  'css',
  'python',
  'py',
  'rust',
  'go',
  'java',
  'kotlin',
  'swift',
  'c',
  'cpp',
  'csharp',
  'cs',
  'ruby',
  'rb',
  'php',
  'diff',
  'patch',
])

export function fenceLangAllowsFilePathList(info: string | undefined): boolean {
  const lang = (info ?? '').trim().toLowerCase()
  if (!lang) return true
  if (lang === 'text' || lang === 'plain' || lang === 'paths' || lang === 'files') return true
  return !BLOCKED_FENCE_LANGS.has(lang)
}
