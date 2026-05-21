import type { ReactNode } from 'react'
import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { ErrorBoundary } from '../../../ErrorBoundary/ErrorBoundary'
import { GenericTool } from './GenericTool'
import { DiffTool } from './DiffTool'
import { BashTool } from './BashTool'
import { ReadTool } from './ReadTool'
import { WriteTool } from './WriteTool'
import { TodoTool } from './TodoTool'
import { GrepTool, ListTool, WebSearchTool } from './InlineTools'
import { asFileChangeOutput } from './diff-utils'
import styles from '../../Conductor.module.css'

type ToolContainer = 'inline' | 'block'
type ToolRenderer = (tool: TimelineToolCall) => ReactNode

interface ToolEntry {
  readonly render: ToolRenderer
  readonly container: ToolContainer
}

const registry = new Map<string, ToolEntry>()

export function registerTool(name: string, render: ToolRenderer, container: ToolContainer): void {
  registry.set(name.toLowerCase(), { render, container })
}

function lookup(name: string): ToolEntry | undefined {
  return registry.get(name.toLowerCase())
}

const diff = (tool: TimelineToolCall): ReactNode => <DiffTool tool={tool} />
for (const name of [
  'apply_patch',
  'file_change',
  'edit',
  'edit_file',
  'str_replace',
  'search_replace',
  'multi_edit',
  'apply_diff',
]) {
  registerTool(name, diff, 'block')
}
for (const name of ['write', 'write_file', 'create_file']) {
  registerTool(name, (tool) => <WriteTool tool={tool} />, 'inline')
}

registerTool('shell', (tool) => <BashTool tool={tool} />, 'block')
registerTool('bash', (tool) => <BashTool tool={tool} />, 'block')
registerTool('read', (tool) => <ReadTool tool={tool} />, 'inline')
for (const name of ['list', 'glob', 'ls']) {
  registerTool(name, (tool) => <ListTool tool={tool} />, 'inline')
}
for (const name of ['grep', 'search', 'ripgrep']) {
  registerTool(name, (tool) => <GrepTool tool={tool} />, 'inline')
}
registerTool('web_search', (tool) => <WebSearchTool tool={tool} />, 'inline')
registerTool('todowrite', (tool) => <TodoTool tool={tool} />, 'block')

/** Dispatches a tool row to its registered renderer (else GenericTool); suppresses `todoread`. */
export function ToolPart({ tool }: { tool: TimelineToolCall }) {
  const name = tool.toolName.toLowerCase()
  if (name === 'todoread') return null
  // The main process attaches reconstructed patches to file-change tools regardless of
  // the exact tool name, so prefer the diff renderer whenever a patch is present.
  const entry = asFileChangeOutput(tool.output) ? lookup('apply_patch') : lookup(name)
  const render = entry?.render ?? ((t: TimelineToolCall) => <GenericTool tool={t} />)
  return (
    <ErrorBoundary
      fallback={<div className={styles.activityRow}>Couldn&apos;t render this tool call.</div>}
    >
      {render(tool)}
    </ErrorBoundary>
  )
}
