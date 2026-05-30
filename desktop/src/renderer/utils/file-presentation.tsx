import {
  createFileTreeIconResolver,
  getBuiltInFileIconColor,
  getBuiltInSpriteSheet,
  type FileTreeIconConfig,
} from '@pierre/trees'
import type { AppearanceThemeId } from '../theme/appearance'
import { STATUS_LABELS } from '../../shared/status-labels'

export type FilePresentationGitStatus = keyof typeof STATUS_LABELS | 'ignored'

// Pierre's built-in tokens for built-in icon sets. Kept as a string type
// because `@pierre/trees` does not re-export `BuiltInFileIconToken`.
export type SharedFileIconToken = string

/** Maps UI appearance presets to `@pierre/trees` built-in sprites (`minimal` | `standard` | `complete`). */
export function getFileTreeIconsForAppearance(_themeId: AppearanceThemeId): FileTreeIconConfig {
  // Pierre only stamps `data-file-tree-colored-icons` for the `complete` set
  // (`isColoredBuiltInIconSet`); `standard` keeps tree icons on `--trees-fg-muted`.
  return { set: 'complete', colored: true }
}

/** Back-compat alias; same as Default preset (`complete`). */
export const SHARED_FILE_TREE_ICONS: FileTreeIconConfig = getFileTreeIconsForAppearance('default')

const iconResolverCache = new Map<string, ReturnType<typeof createFileTreeIconResolver>>()

function resolverForAppearance(themeId: AppearanceThemeId) {
  const icons = getFileTreeIconsForAppearance(themeId)
  const key = `${icons.set}:${Boolean(icons.colored)}`
  let resolver = iconResolverCache.get(key)
  if (!resolver) {
    resolver = createFileTreeIconResolver(icons)
    iconResolverCache.set(key, resolver)
  }
  return resolver
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

interface ResolvedSharedIcon {
  token: SharedFileIconToken
  symbolId: string
}

function resolveSharedIcon(path: string, appearanceThemeId: AppearanceThemeId): ResolvedSharedIcon {
  const fileName = getBaseName(path)
  const resolved = resolverForAppearance(appearanceThemeId).resolveIcon('file-tree-icon-file', fileName) as {
    name: string
    token?: string
  }
  return {
    token: resolved.token ?? 'default',
    symbolId: resolved.name,
  }
}

/** Pierre only paints per-token colors in-host when the set is `complete`; match that so tabs align with the file tree. */
function useSemanticBuiltinIconColors(themeId: AppearanceThemeId): boolean {
  return getFileTreeIconsForAppearance(themeId).set === 'complete'
}

export function resolveSharedFileIconToken(path: string, appearanceThemeId: AppearanceThemeId = 'default'): SharedFileIconToken {
  return resolveSharedIcon(path, appearanceThemeId).token
}

export function getFileGitBadge(status: FilePresentationGitStatus | null | undefined): string | null {
  if (!status) return null
  return STATUS_LABELS[status] ?? null
}

export function getFilePresentation(
  path: string,
  gitStatus?: FilePresentationGitStatus | null,
  appearanceThemeId: AppearanceThemeId = 'default',
): FilePresentation {
  const fileName = getBaseName(path)
  const { token, symbolId } = resolveSharedIcon(path, appearanceThemeId)

  return {
    displayTitle: fileName,
    fileName,
    gitBadge: getFileGitBadge(gitStatus),
    gitStatus: gitStatus ?? null,
    iconColor: useSemanticBuiltinIconColors(appearanceThemeId) ? getBuiltInFileIconColor(token) : undefined,
    iconSymbolId: symbolId,
    iconToken: token,
  }
}

/** SVG `<symbol>` defs for tab strip — must match the same {@link AppearanceThemeId} passed to {@link SharedFileIcon}. */
export function SharedFileIconDefs({ appearanceThemeId }: { appearanceThemeId: AppearanceThemeId }) {
  const set = getFileTreeIconsForAppearance(appearanceThemeId).set ?? 'complete'
  const sheet = getBuiltInSpriteSheet(set)
  return (
    <div
      aria-hidden="true"
      style={{ display: 'none' }}
      key={appearanceThemeId}
      dangerouslySetInnerHTML={{ __html: sheet }}
    />
  )
}

/** Imperative twin of {@link SharedFileIcon} for contenteditable / CodeMirror DOM chips. */
export function createSharedFileIconElement(
  path: string,
  className: string,
  appearanceThemeId: AppearanceThemeId = 'default',
): SVGSVGElement {
  const presentation = getFilePresentation(path, undefined, appearanceThemeId)
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('class', className)
  icon.setAttribute('viewBox', '0 0 16 16')
  icon.setAttribute('data-file-icon-token', presentation.iconToken)
  if (presentation.iconColor) {
    icon.style.color = presentation.iconColor
  }
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  use.setAttribute('href', `#${presentation.iconSymbolId}`)
  icon.appendChild(use)
  return icon
}

export function SharedFileIcon({
  path,
  className,
  appearanceThemeId,
}: {
  path: string
  className?: string
  appearanceThemeId: AppearanceThemeId
}) {
  const presentation = getFilePresentation(path, undefined, appearanceThemeId)
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
