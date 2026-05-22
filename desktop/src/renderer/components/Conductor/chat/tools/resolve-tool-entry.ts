import type { ReactNode } from 'react'
import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { asFileChangeOutput } from './diff-utils'
import { classifyToolRegistryKey } from './tool-name-classify'

export type ToolRenderer = (tool: TimelineToolCall) => ReactNode

export interface ToolEntry {
  readonly render: ToolRenderer
  readonly container: 'inline' | 'block'
}

const registry = new Map<string, ToolEntry>()

export function registerToolEntry(name: string, entry: ToolEntry): void {
  registry.set(name.toLowerCase(), entry)
}

function lookupExact(name: string): ToolEntry | undefined {
  return registry.get(name.toLowerCase())
}

/** Map Cursor/Codex harness tool names (and input shape) to a Cursor-style renderer. */
export function resolveToolEntry(tool: TimelineToolCall): ToolEntry | undefined {
  const exact = lookupExact(tool.toolName)
  if (exact) return exact

  const key = classifyToolRegistryKey(
    tool.toolName,
    tool.label,
    tool.input,
    Boolean(asFileChangeOutput(tool.output)),
  )
  return key ? lookupExact(key) : undefined
}
