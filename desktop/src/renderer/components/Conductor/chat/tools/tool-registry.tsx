import type { ReactNode } from 'react'
import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { ErrorBoundary } from '../../../ErrorBoundary/ErrorBoundary'
import { CursorFallbackRow } from './CursorFallbackRow'
import { DiffTool } from './DiffTool'
import { BashTool } from './BashTool'
import { ReadTool } from './ReadTool'
import { WriteTool } from './WriteTool'
import { TodoTool } from './TodoTool'
import { GrepTool, ListTool, WebSearchTool } from './InlineTools'
import { asFileChangeOutput } from './diff-utils'
import { registerToolEntry, resolveToolEntry } from './resolve-tool-entry'
import { filesFromTool } from './tool-file-change'
import styles from '../../Conductor.module.css'

const diff = (tool: TimelineToolCall): ReactNode => <DiffTool tool={tool} />

for (const name of [
  'apply_patch',
  'file_change',
  'edit',
  'edit_file',
  'str_replace',
  'search_replace',
  'searchreplace',
  'multi_edit',
  'apply_diff',
  'replace',
  'patch',
  'delete',
  'delete_file',
  'remove_file',
]) {
  registerToolEntry(name, { render: diff, container: 'block' })
}

for (const name of ['write', 'write_file', 'create_file', 'touch']) {
  registerToolEntry(name, { render: (tool) => <WriteTool tool={tool} />, container: 'inline' })
}

for (const name of [
  'shell',
  'bash',
  'command',
  'command_execution',
  'run_terminal_cmd',
  'terminal',
  'execute',
]) {
  registerToolEntry(name, { render: (tool) => <BashTool tool={tool} />, container: 'inline' })
}

for (const name of ['read', 'read_file', 'readfile', 'cat', 'view', 'open_file']) {
  registerToolEntry(name, { render: (tool) => <ReadTool tool={tool} />, container: 'inline' })
}

for (const name of ['list', 'glob', 'ls', 'list_dir', 'listdir', 'dir']) {
  registerToolEntry(name, { render: (tool) => <ListTool tool={tool} />, container: 'inline' })
}

for (const name of ['grep', 'search', 'ripgrep', 'rg', 'codebase_search', 'find']) {
  registerToolEntry(name, { render: (tool) => <GrepTool tool={tool} />, container: 'inline' })
}

registerToolEntry('web_search', { render: (tool) => <WebSearchTool tool={tool} />, container: 'inline' })
registerToolEntry('todowrite', { render: (tool) => <TodoTool tool={tool} />, container: 'block' })

/** Dispatches a tool row to its registered renderer; suppresses `todoread`. */
export function ToolPart({ tool }: { tool: TimelineToolCall }) {
  const name = tool.toolName.toLowerCase()
  if (name === 'todoread') return null

  const hasFileChange =
    Boolean(asFileChangeOutput(tool.output)) || filesFromTool(tool).length > 0
  const resolved = hasFileChange ? { render: diff, container: 'inline' as const } : resolveToolEntry(tool)
  const render = resolved?.render ?? ((t: TimelineToolCall) => <CursorFallbackRow tool={t} />)

  return (
    <ErrorBoundary
      fallback={<div className={styles.activityRow}>Couldn&apos;t render this tool call.</div>}
    >
      {render(tool)}
    </ErrorBoundary>
  )
}
