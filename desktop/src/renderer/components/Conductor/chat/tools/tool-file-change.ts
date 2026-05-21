import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { pathFromInput } from './tool-input-path'
import { asFileChangeOutput } from './diff-utils'

export interface ToolFileEntry {
  readonly path: string
  readonly patch: string
}

function collectCodexChangePaths(value: unknown, out: string[]): void {
  if (!Array.isArray(value)) return
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const path = (entry as { path?: unknown }).path
    if (typeof path === 'string' && path.trim()) out.push(path.trim())
  }
}

/** Resolve changed files from transcript output and/or Codex `changes[]` input. */
export function filesFromTool(tool: TimelineToolCall): readonly ToolFileEntry[] {
  const fromOutput = asFileChangeOutput(tool.output)
  if (fromOutput?.files.length) {
    return fromOutput.files.map((f) => ({ path: f.path, patch: f.patch ?? '' }))
  }

  const paths: string[] = []
  collectCodexChangePaths(tool.input, paths)
  collectCodexChangePaths(tool.output, paths)
  const single = pathFromInput(tool.input)
  if (single && !paths.includes(single)) paths.unshift(single)

  if (paths.length === 0) return []
  return paths.map((path) => ({ path, patch: '' }))
}
