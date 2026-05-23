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
import { filesFromTool, isMutateToolName } from './tool-file-change'
import { JsonCanvasTool } from './JsonCanvasTool'
import { isJsonCanvasToolName } from '../../../../../shared/json-canvas-schema'
import { SkillLoadTool } from './SkillLoadTool'
import { isSkillLoadToolName } from '../../../../../shared/skill-tool-utils'
import styles from '../../Conductor.module.css'
import { GeneratedImageTool } from './GeneratedImageTool'
import { isConductorGeneratedImageOutput } from '../../../../../shared/conductor-generated-images'

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

for (const name of ['skill', 'load_skill', 'skill_load']) {
  registerToolEntry(name, { render: (tool) => <SkillLoadTool tool={tool} />, container: 'inline' })
}

for (const name of ['askquestion', 'ask_question']) {
  registerToolEntry(name, {
    render: (tool) => <CursorFallbackRow tool={tool} />,
    container: 'inline',
  })
}

registerToolEntry('render_json_canvas', {
  render: (tool) => <JsonCanvasTool tool={tool} />,
  container: 'block',
})

for (const name of ['json_canvas', 'constellagent.render_json_canvas']) {
  registerToolEntry(name, {
    render: (tool) => <JsonCanvasTool tool={tool} />,
    container: 'block',
  })
}

/** Dispatches a tool row to its registered renderer; suppresses `todoread`. */
export function ToolPart({ tool }: { tool: TimelineToolCall }) {
  const name = tool.toolName.toLowerCase()
  if (name === 'todoread') return null

  if (isJsonCanvasToolName(tool.toolName)) {
    return (
      <ErrorBoundary
        fallback={<div className={styles.activityRow}>Couldn&apos;t render this canvas.</div>}
      >
        <JsonCanvasTool tool={tool} />
      </ErrorBoundary>
    )
  }

  if (isSkillLoadToolName(tool.toolName)) {
    return (
      <ErrorBoundary
        fallback={<div className={styles.activityRow}>Couldn&apos;t render this skill load.</div>}
      >
        <SkillLoadTool tool={tool} />
      </ErrorBoundary>
    )
  }

  if (isConductorGeneratedImageOutput(tool.output)) {
    return (
      <ErrorBoundary
        fallback={<div className={styles.activityRow}>Couldn&apos;t render this generated image.</div>}
      >
        <GeneratedImageTool tool={tool} />
      </ErrorBoundary>
    )
  }

  const resolved = resolveToolEntry(tool)
  const hasStructuredFileChange = Boolean(asFileChangeOutput(tool.output))
  const mutateFileEntries = isMutateToolName(tool.toolName) ? filesFromTool(tool) : []
  const useDiff =
    hasStructuredFileChange ||
    (isMutateToolName(tool.toolName) && mutateFileEntries.length > 0)
  const entry = useDiff ? { render: diff, container: 'inline' as const } : resolved
  const render = entry?.render ?? ((t: TimelineToolCall) => <CursorFallbackRow tool={t} />)

  return (
    <ErrorBoundary
      fallback={<div className={styles.activityRow}>Couldn&apos;t render this tool call.</div>}
    >
      {render(tool)}
    </ErrorBoundary>
  )
}
