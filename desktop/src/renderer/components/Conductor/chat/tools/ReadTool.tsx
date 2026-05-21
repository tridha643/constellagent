import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { InlineToolRow, pathFromInput } from './InlineTools'

function DocGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M6 3h8l4 4v14a0 0 0 0 1 0 0H6a0 0 0 0 1 0 0V3Z" strokeLinejoin="round" />
      <path d="M14 3v4h4" strokeLinejoin="round" />
      <path d="M8.5 12h7M8.5 15.5h7" strokeLinecap="round" />
    </svg>
  )
}

function lineCount(output: unknown): number | undefined {
  if (typeof output !== 'string' || !output) return undefined
  return output.split('\n').length
}

/** Compact `read` row (shot 4): icon + `Read N lines` + file chip, no body. */
export function ReadTool({ tool }: { tool: TimelineToolCall }) {
  const path = pathFromInput(tool.input)
  const lines = lineCount(tool.output)
  const label = lines ? `Read ${lines} line${lines === 1 ? '' : 's'}` : 'Read'
  return <InlineToolRow icon={<DocGlyph />} label={label} path={path} />
}
