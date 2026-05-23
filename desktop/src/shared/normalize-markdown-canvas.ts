import { normalizeMarkdownTables } from './normalize-markdown-tables'
import { splitInlineCanvasMessage, looksLikeInlineCanvasStream } from './json-canvas-inline'
import {
  parsePartialRenderJsonCanvasFromText,
  parseRenderJsonCanvasFromText,
  type JsonRenderSpec,
  type RenderJsonCanvasParams,
} from './json-canvas-schema'

const JSON_CANVAS_FENCE = /```(?:json_canvas|json)\s*\n([\s\S]*?)\n?```/gi

export type AssistantMarkdownNormalization = {
  markdown: string
  canvas: JsonRenderSpec | null
  canvasTitle?: string
  /** True while streaming canvas output that is not yet renderable. */
  canvasLoading: boolean
}

function looksLikeLegacyCanvasJsonText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return false
  return (
    /"elementsJson"\s*:/.test(trimmed) ||
    /"canvas"\s*:/.test(trimmed) ||
    (/"root"\s*:/.test(trimmed) && /"type"\s*:/.test(trimmed))
  )
}

function looksLikeStreamingLegacyCanvasJson(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return false
  return /^\{\s*"(?:title|description|root|canvas|elementsJson)"/.test(trimmed)
}

function parseLegacyCanvasText(text: string, streaming: boolean): RenderJsonCanvasParams | null {
  return streaming
    ? parsePartialRenderJsonCanvasFromText(text)
    : parseRenderJsonCanvasFromText(text)
}

function extractLegacyFencedCanvas(
  text: string,
  streaming: boolean,
): { prose: string; params: RenderJsonCanvasParams | null } {
  let params: RenderJsonCanvasParams | null = null
  const prose = text.replace(JSON_CANVAS_FENCE, (match, inner: string) => {
    const parsed = parseLegacyCanvasText(String(inner).trim(), streaming)
    if (parsed) {
      params ??= parsed
      return ''
    }
    return match
  })
  return { prose: prose.trim(), params }
}

function titleFromLegacyParams(params: RenderJsonCanvasParams): string | undefined {
  if (params.title?.trim()) return params.title.trim()
  const rootEl = params.canvas.elements[params.canvas.root]
  if (rootEl?.type === 'Card') {
    const title = rootEl.props?.title
    if (typeof title === 'string' && title.trim()) return title.trim()
  }
  return undefined
}

/** Legacy fallback: whole JSON blobs (pre-inline-mode transcripts). */
function extractLegacyCanvasFromAssistantText(
  text: string,
  options?: { streaming?: boolean },
): Pick<AssistantMarkdownNormalization, 'canvas' | 'canvasTitle' | 'canvasLoading'> & { prose: string } {
  const streaming = options?.streaming ?? false
  const trimmed = text.trim()
  if (!trimmed) {
    return { prose: text, canvas: null, canvasLoading: false }
  }

  if (looksLikeLegacyCanvasJsonText(trimmed)) {
    const params = parseLegacyCanvasText(trimmed, streaming)
    if (params) {
      return {
        prose: '',
        canvas: params.canvas,
        canvasTitle: titleFromLegacyParams(params),
        canvasLoading: false,
      }
    }
    if (streaming && looksLikeStreamingLegacyCanvasJson(trimmed)) {
      return { prose: '', canvas: null, canvasLoading: true }
    }
  }

  const fenced = extractLegacyFencedCanvas(text, streaming)
  if (fenced.params) {
    return {
      prose: fenced.prose,
      canvas: fenced.params.canvas,
      canvasTitle: titleFromLegacyParams(fenced.params),
      canvasLoading: false,
    }
  }

  const leading = trimmed.match(/^(\{[\s\S]*\})([\s\S]*)$/)
  if (leading) {
    const [, jsonPart, rest] = leading
    if (looksLikeLegacyCanvasJsonText(jsonPart)) {
      const params = parseLegacyCanvasText(jsonPart, streaming)
      if (params) {
        return {
          prose: rest.trim(),
          canvas: params.canvas,
          canvasTitle: titleFromLegacyParams(params),
          canvasLoading: false,
        }
      }
    }
  }

  const trailing = trimmed.match(/^([\s\S]*?)(\{[\s\S]*\})$/)
  if (trailing) {
    const [, before, jsonPart] = trailing
    if (looksLikeLegacyCanvasJsonText(jsonPart)) {
      const params = parseLegacyCanvasText(jsonPart, streaming)
      if (params) {
        return {
          prose: before.trim(),
          canvas: params.canvas,
          canvasTitle: titleFromLegacyParams(params),
          canvasLoading: false,
        }
      }
    }
  }

  if (streaming && looksLikeStreamingLegacyCanvasJson(trimmed)) {
    return { prose: '', canvas: null, canvasLoading: true }
  }

  return { prose: text, canvas: null, canvasLoading: false }
}

/** Normalize assistant markdown: inline SpecStream + legacy JSON, then table fixes. */
export function normalizeAssistantMarkdown(
  text: string,
  options?: { streaming?: boolean },
): AssistantMarkdownNormalization {
  const streaming = options?.streaming ?? false

  if (looksLikeInlineCanvasStream(text) || (streaming && text.includes('"op"'))) {
    const inline = splitInlineCanvasMessage(text, { streaming })
    if (inline.canvas || inline.canvasLoading || inline.prose !== text) {
      return {
        markdown: normalizeMarkdownTables(inline.prose),
        canvas: inline.canvas,
        canvasTitle: inline.canvasTitle,
        canvasLoading: inline.canvasLoading,
      }
    }
  }

  const legacy = extractLegacyCanvasFromAssistantText(text, { streaming })
  return {
    markdown: normalizeMarkdownTables(legacy.prose),
    canvas: legacy.canvas,
    canvasTitle: legacy.canvasTitle,
    canvasLoading: legacy.canvasLoading,
  }
}
