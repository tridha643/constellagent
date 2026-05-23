import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { pathFromObjectInput } from './tool-input-path'
import { asFileChangeOutput } from './diff-utils'

export interface ToolFileEntry {
  readonly path: string
  readonly patch: string
}

export type ToolFileOperation = 'edit' | 'write' | 'delete'

export interface ToolFileChange extends ToolFileEntry {
  readonly operation: ToolFileOperation
}

const MUTATE_TOOL_PATTERN =
  /(?:apply_patch|file_change|edit|edit_file|str_replace|search_replace|searchreplace|multi_edit|apply_diff|replace|patch|delete|delete_file|remove_file|write|write_file|create_file|touch)/

/** Tool names (Codex + Cursor) that mutate files — mirrors agent-chat-host classification. */
export function isMutateToolName(name: string): boolean {
  return MUTATE_TOOL_PATTERN.test(name.toLowerCase())
}

function operationFromToolName(name: string): ToolFileOperation {
  const normalized = name.toLowerCase()
  if (/(?:delete|remove|unlink)/.test(normalized)) return 'delete'
  if (/(?:write|create|touch)/.test(normalized)) return 'write'
  return 'edit'
}

function operationFromCodexKind(kind: unknown): ToolFileOperation {
  if (typeof kind !== 'string') return 'edit'
  const normalized = kind.toLowerCase()
  if (/(?:delete|remove)/.test(normalized)) return 'delete'
  if (/(?:add|create|write|new)/.test(normalized)) return 'write'
  return 'edit'
}

function collectCodexChanges(value: unknown, out: ToolFileChange[]): void {
  if (!Array.isArray(value)) return
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const path = (entry as { path?: unknown }).path
    if (typeof path === 'string' && path.trim()) {
      out.push({
        path: path.trim(),
        patch: '',
        operation: operationFromCodexKind((entry as { kind?: unknown }).kind),
      })
    }
  }
}

function dedupeFileChanges(changes: readonly ToolFileChange[]): readonly ToolFileChange[] {
  const byPath = new Map<string, ToolFileChange>()
  for (const change of changes) {
    const previous = byPath.get(change.path)
    if (!previous) {
      byPath.set(change.path, change)
      continue
    }
    byPath.set(change.path, {
      path: change.path,
      patch: previous.patch || change.patch,
      operation: mergeOperation(previous.operation, change.operation),
    })
  }
  return [...byPath.values()]
}

function mergeOperation(a: ToolFileOperation, b: ToolFileOperation): ToolFileOperation {
  if (a === 'delete' || b === 'delete') return 'delete'
  if (a === 'write' || b === 'write') return 'write'
  return 'edit'
}

/** Resolve changed files with edit/write/delete operation from tool payloads. */
export function fileChangesFromTool(tool: TimelineToolCall): readonly ToolFileChange[] {
  const fallbackOperation = operationFromToolName(tool.toolName)
  const fromOutput = asFileChangeOutput(tool.output)
  if (fromOutput?.files.length) {
    return dedupeFileChanges(
      fromOutput.files.map((f) => ({
        path: f.path,
        patch: f.patch ?? '',
        operation: fallbackOperation,
      })),
    )
  }

  const changes: ToolFileChange[] = []
  collectCodexChanges(tool.input, changes)
  collectCodexChanges(tool.output, changes)

  if (isMutateToolName(tool.toolName)) {
    const single = pathFromObjectInput(tool.input)
    if (single && !changes.some((change) => change.path === single)) {
      changes.unshift({ path: single, patch: '', operation: fallbackOperation })
    }
  }

  return dedupeFileChanges(changes)
}

/** Resolve changed files from transcript output and/or Codex `changes[]` input. */
export function filesFromTool(tool: TimelineToolCall): readonly ToolFileEntry[] {
  return fileChangesFromTool(tool).map(({ path, patch }) => ({ path, patch }))
}

export function fileChangesFromTools(tools: readonly TimelineToolCall[]): readonly ToolFileChange[] {
  const changes: ToolFileChange[] = []
  for (const tool of tools) {
    if (!isMutateToolName(tool.toolName) && !asFileChangeOutput(tool.output)) continue
    changes.push(...fileChangesFromTool(tool))
  }
  return dedupeFileChanges(changes)
}
