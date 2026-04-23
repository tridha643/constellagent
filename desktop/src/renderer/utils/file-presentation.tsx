import {
  createFileTreeIconResolver,
  getBuiltInFileIconColor,
  getBuiltInSpriteSheet,
  type FileTreeIconConfig,
} from '@pierre/trees'
import { STATUS_LABELS } from '../../shared/status-labels'

export type FilePresentationGitStatus = keyof typeof STATUS_LABELS | 'ignored'

// Pierre's built-in tokens for the 'complete' icon set. Kept as a string type
// because `@pierre/trees` does not re-export `BuiltInFileIconToken`.
export type SharedFileIconToken = string

const TREE_ICON_SET = 'complete' as const

export const SHARED_FILE_TREE_ICONS: FileTreeIconConfig = {
  set: TREE_ICON_SET,
  colored: true,
}

const sharedIconResolver = createFileTreeIconResolver(SHARED_FILE_TREE_ICONS)

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

interface ResolvedSharedIcon {
  token: SharedFileIconToken
  symbolId: string
}

function resolveSharedIcon(path: string): ResolvedSharedIcon {
  const fileName = getBaseName(path)
  const resolved = sharedIconResolver.resolveIcon('file-tree-icon-file', fileName) as {
    name: string
    token?: string
  }
  return {
    token: resolved.token ?? 'default',
    symbolId: resolved.name,
  }
}

export function resolveSharedFileIconToken(path: string): SharedFileIconToken {
  return resolveSharedIcon(path).token
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
  const { token, symbolId } = resolveSharedIcon(path)

  return {
    displayTitle: fileName,
    fileName,
    gitBadge: getFileGitBadge(gitStatus),
    gitStatus: gitStatus ?? null,
    iconColor: getBuiltInFileIconColor(token),
    iconSymbolId: symbolId,
    iconToken: token,
  }
}

const SHARED_TREE_ICON_SPRITE_SHEET = getBuiltInSpriteSheet(TREE_ICON_SET)

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
