import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import {
  extractConductorGeneratedImages,
  normalizeConductorGeneratedImageOutput,
} from '../../../../../shared/conductor-generated-images'
import { GeneratedImageBlock } from '../GeneratedImageBlock'

export function GeneratedImageTool({ tool }: { tool: TimelineToolCall }) {
  const output =
    normalizeConductorGeneratedImageOutput(tool.output) ??
    extractConductorGeneratedImages(tool.output, {
      toolName: tool.toolName,
      input: tool.input,
    })
  const images = output?.images ?? []
  const streaming = tool.status === 'running'

  return (
    <GeneratedImageBlock
      title={tool.label || (streaming ? 'Generating image…' : 'Generated image')}
      description={tool.detail}
      images={images}
      streaming={streaming}
    />
  )
}
