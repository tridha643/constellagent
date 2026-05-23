import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { normalizeCanvasOutput } from '../../../../../shared/json-canvas-schema'
import { JsonCanvasBlock } from '../JsonCanvasBlock'
import styles from '../../Conductor.module.css'

function paramsFromTool(tool: TimelineToolCall) {
  return normalizeCanvasOutput(tool.input) ?? normalizeCanvasOutput(tool.output)
}

function canvasErrorDetail(tool: TimelineToolCall): string {
  const raw = tool.output ?? tool.input
  if (typeof raw === 'string' && raw.trim()) {
    const preview = raw.trim().slice(0, 160)
    return preview.length < raw.trim().length ? `${preview}…` : preview
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    if (typeof record.root === 'string' && typeof record.elementsJson !== 'string') {
      return 'Flat canvas output is missing elementsJson (stringified element map).'
    }
    if (typeof record.root === 'string' && typeof record.elementsJson === 'string') {
      try {
        JSON.parse(record.elementsJson)
      } catch {
        return 'elementsJson is not valid JSON.'
      }
    }
    if (!('canvas' in record) && !('root' in record)) {
      return 'Response is missing canvas.root or flat root/elementsJson fields.'
    }
  }
  return 'Response did not match the expected canvas schema.'
}

export function JsonCanvasTool({ tool }: { tool: TimelineToolCall }) {
  const params = paramsFromTool(tool)
  if (!params) {
    return (
      <div className={styles.jsonCanvasError} data-testid="json-canvas-error">
        Could not render canvas — {canvasErrorDetail(tool)}
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
