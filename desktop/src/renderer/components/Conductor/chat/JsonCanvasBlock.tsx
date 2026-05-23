import type { Spec } from '@json-render/core'
import { JSONUIProvider, Renderer } from '@json-render/react'
import type { JsonRenderSpec } from '../../../../shared/json-canvas-schema'
import { jsonCanvasRegistry } from './json-canvas-registry'
import styles from '../Conductor.module.css'

function toSpec(canvas: JsonRenderSpec): Spec {
  return canvas as Spec
}

export function JsonCanvasBlock({
  title,
  description,
  canvas,
  streaming = false,
}: {
  title?: string
  description?: string
  canvas: JsonRenderSpec
  streaming?: boolean
}) {
  const canRender = Boolean(canvas.root && canvas.elements[canvas.root])
  const showRenderer = canRender || streaming

  return (
    <div
      className={[
        styles.jsonCanvasBlock,
        streaming ? styles.jsonCanvasBlockStreaming : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="json-canvas-block"
      data-streaming={streaming ? 'true' : 'false'}
    >
      {title ? <div className={styles.jsonCanvasBlockTitle}>{title}</div> : null}
      {description ? <div className={styles.jsonCanvasBlockDescription}>{description}</div> : null}
      {showRenderer ? (
        <div className={styles.jsonCanvasRenderer}>
          <JSONUIProvider registry={jsonCanvasRegistry} initialState={canvas.state ?? {}}>
            <Renderer
              spec={canRender ? toSpec(canvas) : null}
              registry={jsonCanvasRegistry}
              loading={streaming}
            />
          </JSONUIProvider>
        </div>
      ) : null}
    </div>
  )
}
