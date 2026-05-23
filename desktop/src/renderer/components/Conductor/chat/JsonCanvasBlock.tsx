import type { Spec } from '@json-render/core'
import { defineRegistry, JSONUIProvider, Renderer } from '@json-render/react'
import type { JsonRenderSpec } from '../../../../shared/json-canvas-schema'
import { jsonCanvasCatalog } from './json-canvas-catalog'
import styles from '../Conductor.module.css'

const { registry } = defineRegistry(jsonCanvasCatalog, {
  components: {
    Card: ({ props, children }) => (
      <section className={styles.jsonCanvasCard}>
        {props.title ? <header className={styles.jsonCanvasCardTitle}>{props.title}</header> : null}
        <div className={styles.jsonCanvasCardBody}>{children}</div>
      </section>
    ),
    Stack: ({ props, children }) => (
      <div
        className={[
          styles.jsonCanvasStack,
          props.gap === 'sm' ? styles.jsonCanvasStackSm : '',
          props.gap === 'lg' ? styles.jsonCanvasStackLg : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </div>
    ),
    Text: ({ props }) => (
      <p
        className={[
          styles.jsonCanvasText,
          props.variant === 'caption' ? styles.jsonCanvasTextCaption : '',
          props.variant === 'heading' ? styles.jsonCanvasTextHeading : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {props.text}
      </p>
    ),
    Metric: ({ props }) => (
      <div className={styles.jsonCanvasMetric}>
        <div className={styles.jsonCanvasMetricLabel}>{props.label}</div>
        <div className={styles.jsonCanvasMetricValue}>{props.value}</div>
      </div>
    ),
    Badge: ({ props }) => <span className={styles.jsonCanvasBadge}>{props.label}</span>,
    Divider: () => <hr className={styles.jsonCanvasDivider} />,
  },
})

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
      <JSONUIProvider registry={registry} initialState={canvas.state ?? {}}>
        <Renderer spec={toSpec(canvas)} registry={registry} />
      </JSONUIProvider>
    </div>
  )
}
