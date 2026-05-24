import { defineRegistry } from '@json-render/react'
import { shadcnComponents } from '@json-render/shadcn'
import { jsonCanvasCatalog } from '../../../../shared/json-canvas-catalog'
import { parseFilePathListText } from '../../../../shared/file-path-list-text'
import { FilePathListPanel } from './FilePathListPanel'
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
    Text: ({ props }) => {
      const paths = parseFilePathListText(props.text)
      if (paths) return <FilePathListPanel paths={paths} />
      return (
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
      )
    },
    FilePathList: ({ props }) => <FilePathListPanel paths={props.paths} />,
    Metric: ({ props }) => (
      <div className={styles.jsonCanvasMetric}>
        <div className={styles.jsonCanvasMetricLabel}>{props.label}</div>
        <div className={styles.jsonCanvasMetricValue}>{props.value}</div>
      </div>
    ),
    Badge: ({ props }) => <span className={styles.jsonCanvasBadge}>{props.label}</span>,
    Divider: () => <hr className={styles.jsonCanvasDivider} />,
    Grid: shadcnComponents.Grid,
    Heading: shadcnComponents.Heading,
    Button: shadcnComponents.Button,
    Table: shadcnComponents.Table,
    Progress: shadcnComponents.Progress,
    Alert: shadcnComponents.Alert,
  },
  actions: {
    refresh_data: async () => {},
  },
})

export { registry as jsonCanvasRegistry }
