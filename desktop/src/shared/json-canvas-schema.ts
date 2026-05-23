import { z } from 'zod'

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

/**
 * Flat Codex structured-output schema — strict-safe (no nested additionalProperties).
 * Model returns `elementsJson` as a stringified element map; host normalizes to RenderJsonCanvasParams.
 */
export function renderJsonCanvasOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      root: { type: 'string' },
      elementsJson: { type: 'string' },
    },
    required: ['title', 'description', 'root', 'elementsJson'],
    additionalProperties: false,
  }
}

/** Ensure every nested schema object has a `type` key (Codex structured-output requirement). */
export function assertCodexCompatibleJsonSchema(schema: unknown, path = 'root'): void {
  if (schema == null || typeof schema !== 'object' || Array.isArray(schema)) return
  const node = schema as Record<string, unknown>
  if ('type' in node || '$ref' in node) {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'type' || key === '$ref') continue
      if (typeof value === 'object' && value !== null) {
        assertCodexCompatibleJsonSchema(value, `${path}.${key}`)
      }
    }
    return
  }
  if (Object.keys(node).length === 0) {
    throw new Error(`Schema at ${path} is empty — Codex requires a type key`)
  }
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'object' && value !== null) {
      assertCodexCompatibleJsonSchema(value, `${path}.${key}`)
    }
  }
}

/** OpenAI strict mode: every key in `properties` must appear in `required`. */
export function assertCodexStrictSchema(schema: unknown, path = 'root'): void {
  assertCodexCompatibleJsonSchema(schema, path)
  if (schema == null || typeof schema !== 'object' || Array.isArray(schema)) return
  const node = schema as Record<string, unknown>
  if (node.type === 'object' && node.properties && typeof node.properties === 'object') {
    const props = node.properties as Record<string, unknown>
    const required = node.required
    if (!Array.isArray(required)) {
      throw new Error(`Schema at ${path} is missing required array`)
    }
    for (const key of Object.keys(props)) {
      if (!required.includes(key)) {
        throw new Error(`Schema at ${path} property "${key}" is not listed in required`)
      }
    }
    for (const [key, value] of Object.entries(props)) {
      assertCodexStrictSchema(value, `${path}.${key}`)
    }
  }
  if (node.type === 'array' && node.items) {
    assertCodexStrictSchema(node.items, `${path}.items`)
  }
}

/** Heuristic: enable canvas for this turn when the user asks for a visual artifact. */
export function detectCanvasIntent(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false

  const patterns = [
    /\b(use\s+)?canvas\b/i,
    /\bjson[\s_-]?canvas\b/i,
    /\brender[\s\S]{0,40}\b(?:dashboard|chart|table|visuali[sz]ation|report|graph|metrics?)\b/i,
    /\b(?:show|display|visuali[sz]e)\b[\s\S]{0,40}\b(?:dashboard|chart|table|visual|report|canvas)\b/i,
    /\b(?:build|create|make)\b[\s\S]{0,40}\b(?:dashboard|visual(?:ization)?|canvas)\b/i,
  ]

  return patterns.some((pattern) => pattern.test(normalized))
}

export function parseRenderJsonCanvasParams(raw: unknown): RenderJsonCanvasParams | null {
  const parsed = RenderJsonCanvasParamsSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Bridge flat Codex output or nested canvas payloads into RenderJsonCanvasParams. */
export function normalizeCanvasOutput(raw: unknown): RenderJsonCanvasParams | null {
  const canonical = parseRenderJsonCanvasParams(raw)
  if (canonical) return canonical

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>

  if (typeof record.root === 'string' && typeof record.elementsJson === 'string') {
    try {
      const elements = JSON.parse(record.elementsJson) as unknown
      if (!elements || typeof elements !== 'object' || Array.isArray(elements)) return null
      return parseRenderJsonCanvasParams({
        title: typeof record.title === 'string' && record.title.trim() ? record.title : undefined,
        description:
          typeof record.description === 'string' && record.description.trim()
            ? record.description
            : undefined,
        canvas: {
          root: record.root,
          elements,
          ...(record.state && typeof record.state === 'object' && !Array.isArray(record.state)
            ? { state: record.state as Record<string, unknown> }
            : {}),
        },
      })
    } catch {
      return null
    }
  }

  return null
}

/** Parse JSON text (optionally wrapped in markdown fences) into canvas params. */
export function parseRenderJsonCanvasFromText(text: string): RenderJsonCanvasParams | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const fenceMatch = trimmed.match(/^```(?:json_canvas|json)?\s*\n?([\s\S]*?)\n?```$/i)
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : trimmed

  try {
    return normalizeCanvasOutput(JSON.parse(candidate))
  } catch {
    return null
  }
}

export function buildJsonCanvasPromptSuffix(provider: 'codex' | 'cursor'): string {
  const codexFlatHint = JSON.stringify(
    {
      title: 'Optional dashboard title (empty string if none)',
      description: 'Optional one-line summary (empty string if none)',
      root: 'root-id',
      elementsJson: JSON.stringify({
        'root-id': {
          type: 'Card',
          props: { title: 'Example' },
          children: ['metric-1'],
        },
        'metric-1': {
          type: 'Metric',
          props: { label: 'Total', value: '42' },
        },
      }),
    },
    null,
    2,
  )

  const cursorNestedHint = JSON.stringify(
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
    provider === 'codex'
      ? 'Respond with a single JSON object matching this flat shape (no markdown prose, no code fences):'
      : 'Respond with a single JSON object matching this shape (no markdown prose, no code fences):',
    provider === 'codex' ? codexFlatHint : cursorNestedHint,
    `Allowed component types: ${CATALOG_COMPONENT_HINTS.map((h) => h.split(' — ')[0]).join(', ')}.`,
    provider === 'codex'
      ? 'Put the element map in elementsJson as a JSON string; root is the root element id.'
      : 'Put the json-render spec in the "canvas" field with "root" and "elements".',
  ]

  if (provider === 'cursor') {
    lines.push('Output ONLY the JSON object — no explanation before or after.')
  } else {
    lines.push('Codex will validate your response against the output schema.')
  }

  return lines.join('\n')
}
