import { z } from 'zod'
import { JSON_CANVAS_INLINE_PROMPT } from './json-canvas-catalog'

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

export function isJsonCanvasToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase()
  return normalized === RENDER_JSON_CANVAS_TOOL_NAME || normalized.endsWith(`.${RENDER_JSON_CANVAS_TOOL_NAME}`)
}

/**
 * Flat Codex structured-output schema — strict-safe (no nested additionalProperties).
 * Legacy standalone-mode schema; inline SpecStream turns stream JSONL in assistant text instead.
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
    /\b(?:render|show|display|draw|build|make|create)\s+(?:something|anything)\b/i,
    /\brender\s+(?:a|an|the)\s+(?:ui|view|layout|screen|panel|card|widget|component|status|summary|report|dashboard|chart|table|visual)\b/i,
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

function stripPartialJsonFence(text: string): string {
  const trimmed = text.trim()
  const openFence = trimmed.match(/^```(?:json_canvas|json)?\s*\n?([\s\S]*)$/i)
  if (openFence) return openFence[1]!.replace(/```\s*$/, '').trim()
  return trimmed
}

function jsonRepairSuffixes(raw: string): string[] {
  const suffixes = new Set<string>([''])
  let braces = 0
  let brackets = 0
  let inString = false
  let escape = false

  for (const ch of raw) {
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') braces += 1
    if (ch === '}') braces = Math.max(0, braces - 1)
    if (ch === '[') brackets += 1
    if (ch === ']') brackets = Math.max(0, brackets - 1)
  }

  let close = ''
  if (inString) close += '"'
  close += ']'.repeat(brackets)
  close += '}'.repeat(braces)
  if (close) suffixes.add(close)
  if (inString && close.startsWith('"')) {
    suffixes.add(`${close}"}`)
    suffixes.add(`${close}"}}`)
  }

  return [...suffixes]
}

function hasRenderableCanvas(params: RenderJsonCanvasParams): boolean {
  const { root, elements } = params.canvas
  return Boolean(root && elements[root])
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

/** Best-effort parse for in-flight canvas JSON (streaming assistant output). */
export function parsePartialRenderJsonCanvasFromText(text: string): RenderJsonCanvasParams | null {
  const full = parseRenderJsonCanvasFromText(text)
  if (full) return full

  const candidate = stripPartialJsonFence(text)
  if (!candidate.startsWith('{')) return null

  for (const suffix of jsonRepairSuffixes(candidate)) {
    try {
      const parsed = normalizeCanvasOutput(JSON.parse(candidate + suffix))
      if (parsed && hasRenderableCanvas(parsed)) return parsed
    } catch {
      // keep trying repaired suffixes
    }
  }
  return null
}

export function buildJsonCanvasPromptSuffix(_provider: 'codex' | 'cursor'): string {
  return [
    'Canvas mode is active. Use json-render inline generation: respond conversationally when helpful, then emit SpecStream JSONL patch lines (one patch object per line).',
    'Do not wrap JSONL patches in markdown code fences unless using a ```spec fence as documented.',
    JSON_CANVAS_INLINE_PROMPT,
  ].join('\n\n')
}
