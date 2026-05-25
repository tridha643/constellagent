import { z } from 'zod'
import { defineCatalog } from '@json-render/core'
import { shadcnComponentDefinitions } from '@json-render/shadcn/catalog'
import { schema } from '@json-render/react/schema'

/**
 * Semantic variants for {@link calloutProps}. Kept as a named tuple so the validator and
 * tests can reference the exact allowed set without re-deriving it from the Zod enum.
 */
export const CALLOUT_VARIANTS = ['info', 'warning', 'error', 'success', 'neutral'] as const
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number]

/**
 * Prop schemas for the constellagent-owned components, declared as standalone consts so
 * that (a) the inline catalog below keeps full per-component type inference for the React
 * registry, and (b) `constellComponentPropSchemas` can re-export the very same schemas for
 * prop-level validation — no duplication, single source of truth.
 *
 * These schemas are simple and literal-valued (no state-binding expressions), which is why
 * the structural validator can check element `props` against them eagerly. shadcn component
 * props are intentionally excluded from that check because they accept binding expressions.
 */
const cardProps = z.object({ title: z.string().optional() })
const stackProps = z.object({ gap: z.enum(['sm', 'md', 'lg']).optional() })
const textProps = z.object({
  text: z.string(),
  variant: z.enum(['body', 'caption', 'heading']).optional(),
})
const calloutProps = z.object({
  text: z.string(),
  variant: z.enum(CALLOUT_VARIANTS).optional(),
  title: z.string().optional(),
})
const filePathListProps = z.object({ paths: z.array(z.string()).min(1) })
const metricProps = z.object({ label: z.string(), value: z.string() })
const badgeProps = z.object({ label: z.string() })
const dividerProps = z.object({})

export const jsonCanvasCatalog = defineCatalog(schema, {
  components: {
    Card: {
      props: cardProps,
      slots: ['default'],
      description: 'Container card with optional title',
    },
    Stack: {
      props: stackProps,
      slots: ['default'],
      description: 'Vertical stack of child elements',
    },
    Text: {
      props: textProps,
      description: 'Text block',
    },
    Callout: {
      props: calloutProps,
      description:
        'Highlighted note with a semantic variant — one of info, warning, error, success, neutral (default info). Use for tips, caveats, and status messages.',
    },
    FilePathList: {
      props: filePathListProps,
      description: 'File path list with icons and copy-all button',
    },
    Metric: {
      props: metricProps,
      description: 'Label/value metric pair',
    },
    Badge: {
      props: badgeProps,
      description: 'Small status badge',
    },
    Divider: {
      props: dividerProps,
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

/**
 * Per-component Zod prop schemas for the constellagent-owned components, exposed so the
 * structural validator can check `props` against the real contract — a layer the catalog's
 * own `validate()` skips (it only checks element `type` and shape, never prop values).
 */
export const constellComponentPropSchemas: Readonly<Record<string, z.ZodType>> = {
  Card: cardProps,
  Stack: stackProps,
  Text: textProps,
  Callout: calloutProps,
  FilePathList: filePathListProps,
  Metric: metricProps,
  Badge: badgeProps,
  Divider: dividerProps,
}

/** Component types constellagent owns directly (excludes the shadcn imports). */
export const CONSTELL_OWNED_COMPONENT_TYPES: ReadonlyArray<string> = Object.keys(
  constellComponentPropSchemas,
)

/** Standalone SpecStream prompt (JSONL only). */
export const JSON_CANVAS_CATALOG_PROMPT = jsonCanvasCatalog.prompt()

/** Inline chat prompt — prose first, then JSONL patch lines per json-render inline mode. */
export const JSON_CANVAS_INLINE_PROMPT = jsonCanvasCatalog.prompt({ mode: 'inline' })
