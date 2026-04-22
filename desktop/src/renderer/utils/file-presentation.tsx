import { getBuiltInFileIconColor, getBuiltInSpriteSheet, type FileTreeIconConfig } from '@pierre/trees'
import { STATUS_LABELS } from '../../shared/status-labels'

export type FilePresentationGitStatus = keyof typeof STATUS_LABELS | 'ignored'

export type SharedFileIconToken =
  | 'bun'
  | 'css'
  | 'database'
  | 'docker'
  | 'git'
  | 'go'
  | 'html'
  | 'image'
  | 'javascript'
  | 'json'
  | 'markdown'
  | 'npm'
  | 'python'
  | 'react'
  | 'rust'
  | 'sass'
  | 'svg'
  | 'text'
  | 'typescript'
  | 'yml'
  | 'zip'
  | 'default'

const SHARED_TREE_ICON_SET = 'standard' as const

const FILE_NAME_ICON_TOKENS: Record<string, SharedFileIconToken> = {
  'package.json': 'npm',
  'package-lock.json': 'npm',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'bunfig.toml': 'bun',
  'dockerfile': 'docker',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  '.editorconfig': 'text',
  'readme.md': 'markdown',
  'readme.mdx': 'markdown',
  'license': 'text',
  'license.md': 'text',
  'tsconfig.json': 'typescript',
  'cargo.toml': 'rust',
  'cargo.lock': 'rust',
  'go.mod': 'go',
  'go.sum': 'go',
  'requirements.txt': 'python',
  'pyproject.toml': 'python',
}

const FILE_NAME_CONTAINS_ICON_TOKENS: Record<string, SharedFileIconToken> = {
  '.env': 'text',
}

const FILE_EXTENSION_ICON_TOKENS: Record<string, SharedFileIconToken> = {
  'd.ts': 'typescript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'react',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'react',
  json: 'json',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yml',
  yaml: 'yml',
  css: 'css',
  scss: 'sass',
  sass: 'sass',
  html: 'html',
  py: 'python',
  rs: 'rust',
  go: 'go',
  prisma: 'database',
  sql: 'database',
  svg: 'svg',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  ico: 'image',
  zip: 'zip',
  gz: 'zip',
  tgz: 'zip',
  txt: 'text',
  toml: 'text',
}

export interface FilePresentation {
  displayTitle: string
  fileName: string
  gitBadge: string | null
  gitStatus: FilePresentationGitStatus | null
  iconColor: string | undefined
  iconSymbolId: string
  iconToken: SharedFileIconToken
}

function getBaseName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || normalized
}

function getExtensionCandidates(fileName: string): string[] {
  const lower = fileName.toLowerCase()
  const pieces = lower.split('.')
  if (pieces.length <= 1) return []

  const candidates: string[] = []
  for (let index = 1; index < pieces.length; index += 1) {
    const candidate = pieces.slice(index).join('.')
    if (candidate) candidates.push(candidate)
  }
  return candidates
}

function iconSymbolId(token: SharedFileIconToken): string {
  return `file-tree-builtin-${token}`
}

function remapIcon(token: SharedFileIconToken): string {
  return iconSymbolId(token)
}

export function resolveSharedFileIconToken(path: string): SharedFileIconToken {
  const fileName = getBaseName(path).toLowerCase()

  const exact = FILE_NAME_ICON_TOKENS[fileName]
  if (exact) return exact

  for (const [needle, token] of Object.entries(FILE_NAME_CONTAINS_ICON_TOKENS)) {
    if (fileName.includes(needle)) return token
  }

  for (const candidate of getExtensionCandidates(fileName)) {
    const token = FILE_EXTENSION_ICON_TOKENS[candidate]
    if (token) return token
  }

  return 'default'
}

export function getFileGitBadge(status: FilePresentationGitStatus | null | undefined): string | null {
  if (!status) return null
  return STATUS_LABELS[status] ?? null
}

export function getFilePresentation(
  path: string,
  gitStatus?: FilePresentationGitStatus | null,
): FilePresentation {
  const fileName = getBaseName(path)
  const iconToken = resolveSharedFileIconToken(path)

  return {
    displayTitle: fileName,
    fileName,
    gitBadge: getFileGitBadge(gitStatus),
    gitStatus: gitStatus ?? null,
    iconColor: getBuiltInFileIconColor(iconToken),
    iconSymbolId: iconSymbolId(iconToken),
    iconToken,
  }
}

export const SHARED_FILE_TREE_ICONS: FileTreeIconConfig = {
  set: SHARED_TREE_ICON_SET,
  colored: false,
  byFileName: Object.fromEntries(
    Object.entries(FILE_NAME_ICON_TOKENS).map(([fileName, token]) => [fileName, remapIcon(token)]),
  ),
  byFileExtension: Object.fromEntries(
    Object.entries(FILE_EXTENSION_ICON_TOKENS).map(([extension, token]) => [extension, remapIcon(token)]),
  ),
  byFileNameContains: Object.fromEntries(
    Object.entries(FILE_NAME_CONTAINS_ICON_TOKENS).map(([needle, token]) => [needle, remapIcon(token)]),
  ),
}

const SHARED_TREE_ICON_SPRITE_SHEET = getBuiltInSpriteSheet(SHARED_TREE_ICON_SET)

export function SharedFileIconDefs() {
  return (
    <div
      aria-hidden="true"
      style={{ display: 'none' }}
      dangerouslySetInnerHTML={{ __html: SHARED_TREE_ICON_SPRITE_SHEET }}
    />
  )
}

export function SharedFileIcon({
  path,
  className,
}: {
  path: string
  className?: string
}) {
  const presentation = getFilePresentation(path)
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-file-icon-token={presentation.iconToken}
      viewBox="0 0 16 16"
      style={presentation.iconColor ? { color: presentation.iconColor } : undefined}
    >
      <use href={`#${presentation.iconSymbolId}`} />
    </svg>
  )
}
