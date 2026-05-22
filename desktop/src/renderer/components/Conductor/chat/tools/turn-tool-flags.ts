import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { asFileChangeOutput } from './diff-utils'
import { isMutateToolName } from './tool-file-change'

export function turnHasFileTools(tools: readonly TimelineToolCall[]): boolean {
  return tools.some(
    (tool) =>
      tool.kind === 'tool' &&
      (Boolean(asFileChangeOutput(tool.output)) || isMutateToolName(tool.toolName)),
  )
}

export function turnHasTodoTools(tools: readonly TimelineToolCall[]): boolean {
  return tools.some((tool) => tool.kind === 'tool' && tool.toolName.toLowerCase() === 'todowrite')
}
