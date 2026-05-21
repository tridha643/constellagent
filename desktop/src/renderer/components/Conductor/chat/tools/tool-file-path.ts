import { normalizePath } from './diff-utils'

/** True for Cursor/Codex tools that create or overwrite whole files (not patch edits). */
export function isWriteToolName(toolName: string): boolean {
  const n = toolName.toLowerCase()
  return n === 'write' || n === 'write_file' || n === 'create_file'
}

/** Resolve a tool-relative or absolute path against the active workspace worktree. */
export function resolveToolFileAbsolutePath(worktreePath: string, filePath: string): string {
  const trimmed = filePath.trim()
  if (!trimmed) return worktreePath

  const normalized = trimmed.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    return trimmed
  }

  const basePath = worktreePath.replace(/[\\/]+$/, '')
  const relative = normalized.replace(/^\.\//, '').replace(/^\/+/, '')
  return relative ? `${basePath}/${relative}` : basePath
}

export function toolFileBasename(path: string): string {
  const display = normalizePath(path)
  return display.split('/').pop() || display
}
