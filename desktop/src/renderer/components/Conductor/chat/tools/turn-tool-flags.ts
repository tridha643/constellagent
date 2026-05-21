import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { filesFromTool } from './tool-file-change'

export function turnHasFileTools(tools: readonly TimelineToolCall[]): boolean {
  return tools.some((tool) => tool.kind === 'tool' && filesFromTool(tool).length > 0)
}

export function turnHasTodoTools(tools: readonly TimelineToolCall[]): boolean {
  return tools.some((tool) => tool.kind === 'tool' && tool.toolName.toLowerCase() === 'todowrite')
}
