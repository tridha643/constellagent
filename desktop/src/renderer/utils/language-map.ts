export type MonacoLanguageId =
  | 'typescript'
  | 'typescriptreact'
  | 'javascript'
  | 'javascriptreact'
  | 'prisma'
  | 'json'
  | 'markdown'
  | 'css'
  | 'html'
  | 'python'
  | 'rust'
  | 'go'
  | 'yaml'
  | 'shell'
  | 'ini'
  | 'dotenv'
  | 'plaintext'

export type EditorLanguageOverride =
  | 'typescript'
  | 'typescriptreact'
  | 'javascript'
  | 'javascriptreact'
  | 'python'
  | 'plaintext'

const LANGUAGE_EXTENSION_MAP: Partial<Record<MonacoLanguageId, string>> = {
  typescript: 'ts',
  typescriptreact: 'tsx',
  javascript: 'js',
  javascriptreact: 'jsx',
  python: 'py',
}

export const EDITOR_LANGUAGE_OVERRIDE_OPTIONS: ReadonlyArray<{
  value: '' | EditorLanguageOverride
  label: string
}> = [
  { value: '', label: 'Auto' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'typescriptreact', label: 'TSX' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'javascriptreact', label: 'JSX' },
  { value: 'python', label: 'Python' },
  { value: 'plaintext', label: 'Plain Text' },
] as const

/** Map file extensions to Monaco language IDs / markdown fence tags. */
const EXT_MAP: Record<string, MonacoLanguageId> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  mjs: 'javascript',
  cjs: 'javascript',
  prisma: 'prisma',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  py: 'python',
  rs: 'rust',
  go: 'go',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  toml: 'ini',
}

const EDITOR_LANGUAGE_OVERRIDE_VALUES = new Set<EditorLanguageOverride>(
  EDITOR_LANGUAGE_OVERRIDE_OPTIONS
    .map((option) => option.value)
    .filter((value): value is EditorLanguageOverride => value !== ''),
)

export function getLanguage(path: string): MonacoLanguageId {
  const fileName = path.split(/[\\/]/).pop()?.toLowerCase() || ''
  if (fileName === '.env' || fileName.startsWith('.env.')) return 'dotenv'

  const ext = fileName.split('.').pop()?.toLowerCase()
  return EXT_MAP[ext || ''] || 'plaintext'
}

/** Short fence tag for markdown code blocks (e.g. "ts" not "typescript"). */
const FENCE_MAP: Record<MonacoLanguageId, string> = {
  typescript: 'ts',
  typescriptreact: 'tsx',
  javascript: 'js',
  javascriptreact: 'jsx',
  prisma: 'prisma',
  python: 'py',
  shell: 'sh',
  json: 'json',
  markdown: 'md',
  css: 'css',
  html: 'html',
  rust: 'rs',
  go: 'go',
  yaml: 'yaml',
  ini: 'ini',
  dotenv: 'dotenv',
  plaintext: 'text',
}

export function getFenceTag(path: string): string {
  return getFenceTagForLanguage(getLanguage(path))
}

export function getFenceTagForLanguage(language: MonacoLanguageId): string {
  return FENCE_MAP[language] || language
}

export function normalizeEditorLanguageOverride(value: unknown): EditorLanguageOverride | null {
  return typeof value === 'string' && EDITOR_LANGUAGE_OVERRIDE_VALUES.has(value as EditorLanguageOverride)
    ? value as EditorLanguageOverride
    : null
}

export function normalizeEditorLanguageOverrideMap(value: unknown): Record<string, EditorLanguageOverride> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, EditorLanguageOverride> = {}
  for (const [key, rawValue] of Object.entries(value)) {
    const normalized = normalizeEditorLanguageOverride(rawValue)
    if (normalized) out[key] = normalized
  }
  return out
}

export function getEditorLanguageOverrideKey(worktreePath: string | undefined, filePath: string): string {
  return `${worktreePath ?? ''}::${filePath}`
}

export function getEffectiveLanguage(
  path: string,
  override: EditorLanguageOverride | null | undefined,
): MonacoLanguageId {
  return override ?? getLanguage(path)
}

export function getEffectiveModelPath(
  filePath: string,
  effectiveLanguage: MonacoLanguageId,
  override: EditorLanguageOverride | null | undefined,
): string {
  if (!override) return filePath
  const extension = LANGUAGE_EXTENSION_MAP[effectiveLanguage]
  if (!extension) return filePath
  return `${filePath}.__constellagent__.${extension}`
}
