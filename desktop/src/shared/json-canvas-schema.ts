import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

/** json-render element map — validated loosely so models can emit catalog types. */
export const JsonRenderSpecSchema = z
  .object({
    root: z.string().min(1),
    elements: z.record(
      z.string(),
      z.object({
        type: z.string().min(1),
        props: z.record(z.string(), z.unknown()).optional(),
        children: z.array(z.string()).optional(),
        visible: z.unknown().optional(),
      }),
    ),
    state: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export type JsonRenderSpec = z.infer<typeof JsonRenderSpecSchema>

export const RenderJsonCanvasParamsSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  canvas: JsonRenderSpecSchema,
})

export type RenderJsonCanvasParams = z.infer<typeof RenderJsonCanvasParamsSchema>

export const RENDER_JSON_CANVAS_TOOL_NAME = 'render_json_canvas'

const CATALOG_COMPONENT_HINTS = [
  'Card — optional title, default slot for children',
  'Stack — vertical layout (gap: sm | md | lg)',
  'Text — body copy (variant: body | caption | heading)',
  'Metric — label + value pair',
  'Badge — short status label',
  'Divider — horizontal rule',
] as const

export function renderJsonCanvasOutputSchema(): Record<string, unknown> {
  return zodToJsonSchema(RenderJsonCanvasParamsSchema, {
    target: 'openAi',
    $refStrategy: 'none',
  }) as Record<string, unknown>
}

export function parseRenderJsonCanvasParams(raw: unknown): RenderJsonCanvasParams | null {
  const parsed = RenderJsonCanvasParamsSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Parse JSON text (optionally wrapped in markdown fences) into canvas params. */
export function parseRenderJsonCanvasFromText(text: string): RenderJsonCanvasParams | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const fenceMatch = trimmed.match(/^```(?:json_canvas|json)?\s*\n?([\s\S]*?)\n?```$/i)
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : trimmed

  try {
    return parseRenderJsonCanvasParams(JSON.parse(candidate))
  } catch {
    return null
  }
}

export function buildJsonCanvasPromptSuffix(provider: 'codex' | 'cursor'): string {
  const schemaHint = JSON.stringify(
    {
      title: 'Optional dashboard title',
      description: 'Optional one-line summary',
      canvas: {
        root: 'root-id',
        elements: {
          'root-id': {
            type: 'Card',
            props: { title: 'Example' },
            children: ['metric-1'],
          },
          'metric-1': {
            type: 'Metric',
            props: { label: 'Total', value: '42' },
          },
        },
      },
    },
    null,
    2,
  )

  const lines = [
    'Canvas mode is active. Produce a visual layout as structured JSON only.',
    'Respond with a single JSON object matching this shape (no markdown prose, no code fences):',
    schemaHint,
    `Allowed component types: ${CATALOG_COMPONENT_HINTS.map((h) => h.split(' — ')[0]).join(', ')}.`,
    'Put the json-render spec in the "canvas" field with "root" and "elements".',
  ]

  if (provider === 'cursor') {
    lines.push('Output ONLY the JSON object — no explanation before or after.')
  } else {
    lines.push('Codex will validate your response against the output schema.')
  }

  return lines.join('\n')
}
