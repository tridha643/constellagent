import { basename, isAbsolute, join, normalize, relative, resolve } from 'path'

const BLOCKED_SEGMENTS = new Set(['.git', 'node_modules'])

export interface BrowserSourceLookupRequest {
  worktreePath: string
  sourceFile: string
  sourceLine?: number
  radius?: number
}

export interface BrowserSourceLookupPlan {
  absolutePath: string
  startLine: number
  endLine: number
}

function isPrivateHiddenSegment(segment: string): boolean {
  if (!segment.startsWith('.')) return false
  return segment !== '.'
}

export function validateBrowserSourceLookupRequest(
  request: BrowserSourceLookupRequest,
): BrowserSourceLookupPlan {
  const worktreePath = resolve(request.worktreePath)
  const rawSource = request.sourceFile.trim()
  if (!worktreePath || !rawSource) throw new Error('Missing source lookup path')
  if (basename(rawSource).toLowerCase().startsWith('.env')) {
    throw new Error('Source lookup blocked for env files')
  }

  const candidate = isAbsolute(rawSource)
    ? resolve(rawSource)
    : resolve(join(worktreePath, normalize(rawSource)))
  const rel = relative(worktreePath, candidate)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Source lookup path escapes worktree')
  }
  const segments = rel.split(/[\\/]+/).filter(Boolean)
  if (segments.some((segment) => BLOCKED_SEGMENTS.has(segment) || isPrivateHiddenSegment(segment))) {
    throw new Error('Source lookup path is blocked')
  }
  if (segments.some((segment) => segment.toLowerCase().startsWith('.env'))) {
    throw new Error('Source lookup blocked for env files')
  }

  const sourceLine = Math.max(1, Math.floor(request.sourceLine || 1))
  const radius = Math.max(0, Math.min(100, Math.floor(request.radius ?? 20)))
  return {
    absolutePath: candidate,
    startLine: Math.max(1, sourceLine - radius),
    endLine: sourceLine + radius,
  }
}
