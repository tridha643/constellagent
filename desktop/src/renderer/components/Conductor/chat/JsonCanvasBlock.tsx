import type { Spec } from '@json-render/core'
import { JSONUIProvider, Renderer } from '@json-render/react'
import type { JsonRenderSpec } from '../../../../shared/json-canvas-schema'
import { validateJsonCanvasSpec } from '../../../../shared/json-canvas-validate'
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

  // Once streaming settles, a still-unrenderable canvas means the model emitted a
  // structurally-invalid spec (missing root element, dangling child, cycle, …). Surface
  // the exact problems instead of rendering a silently-blank block.
  const diagnostics =
    !showRenderer ? validateJsonCanvasSpec(canvas).diagnostics.filter((d) => d.severity === 'error') : []

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
      ) : diagnostics.length ? (
        <div className={styles.jsonCanvasError} data-testid="json-canvas-invalid">
          <div className={styles.jsonCanvasErrorTitle}>Could not render canvas</div>
          <ul className={styles.jsonCanvasErrorList}>
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${diagnostic.path}-${index}`}>
                <code className={styles.jsonCanvasErrorPath}>{diagnostic.path}</code>
                <span>
                  {diagnostic.message}
                  {diagnostic.suggestion ? ` ${diagnostic.suggestion}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
