import { z } from 'zod'
import { defineCatalog } from '@json-render/core'
import { shadcnComponentDefinitions } from '@json-render/shadcn/catalog'
import { schema } from '@json-render/react/schema'

export const jsonCanvasCatalog = defineCatalog(schema, {
  components: {
    Card: {
      props: z.object({
        title: z.string().optional(),
      }),
      slots: ['default'],
      description: 'Container card with optional title',
    },
    Stack: {
      props: z.object({
        gap: z.enum(['sm', 'md', 'lg']).optional(),
      }),
      slots: ['default'],
      description: 'Vertical stack of child elements',
    },
    Text: {
      props: z.object({
        text: z.string(),
        variant: z.enum(['body', 'caption', 'heading']).optional(),
      }),
      description: 'Text block',
    },
    Metric: {
      props: z.object({
        label: z.string(),
        value: z.string(),
      }),
      description: 'Label/value metric pair',
    },
    Badge: {
      props: z.object({
        label: z.string(),
      }),
      description: 'Small status badge',
    },
    Divider: {
      props: z.object({}),
      description: 'Horizontal divider',
    },
    Grid: shadcnComponentDefinitions.Grid,
    Heading: shadcnComponentDefinitions.Heading,
    Button: shadcnComponentDefinitions.Button,
    Table: shadcnComponentDefinitions.Table,
    Progress: shadcnComponentDefinitions.Progress,
    Alert: shadcnComponentDefinitions.Alert,
  },
  actions: {
    refresh_data: {
      description: 'Refresh dashboard metrics',
    },
  },
})

/** Standalone SpecStream prompt (JSONL only). */
export const JSON_CANVAS_CATALOG_PROMPT = jsonCanvasCatalog.prompt()

/** Inline chat prompt — prose first, then JSONL patch lines per json-render inline mode. */
export const JSON_CANVAS_INLINE_PROMPT = jsonCanvasCatalog.prompt({ mode: 'inline' })
