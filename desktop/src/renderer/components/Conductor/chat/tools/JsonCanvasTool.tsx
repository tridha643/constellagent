import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { parseRenderJsonCanvasParams } from '../../../../../shared/json-canvas-schema'
import { JsonCanvasBlock } from '../JsonCanvasBlock'
import styles from '../../Conductor.module.css'

function paramsFromTool(tool: TimelineToolCall) {
  return parseRenderJsonCanvasParams(tool.input) ?? parseRenderJsonCanvasParams(tool.output)
}

export function JsonCanvasTool({ tool }: { tool: TimelineToolCall }) {
  const params = paramsFromTool(tool)
  if (!params) {
    return (
      <div className={styles.jsonCanvasError}>
        Could not render canvas — response did not match the expected schema.
      </div>
    )
  }

  return (
    <JsonCanvasBlock title={params.title} description={params.description} canvas={params.canvas} />
  )
}

export function isJsonCanvasToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase()
  return normalized === 'render_json_canvas' || normalized.endsWith('.render_json_canvas')
}
