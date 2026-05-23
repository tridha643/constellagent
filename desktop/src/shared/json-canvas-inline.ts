import {
  createMixedStreamParser,
  createSpecStreamCompiler,
  type Spec,
} from '@json-render/core'
import type { JsonRenderSpec } from './json-canvas-schema'

export type InlineCanvasSplit = {
  prose: string
  canvas: JsonRenderSpec | null
  canvasTitle?: string
  canvasLoading: boolean
}

function isRenderableSpec(spec: Spec): boolean {
  const root = spec.root
  const elements = spec.elements
  if (typeof root !== 'string' || !root) return false
  if (!elements || typeof elements !== 'object') return false
  const rootEl = elements[root]
  return Boolean(rootEl && typeof rootEl.type === 'string')
}

function asJsonRenderSpec(spec: Spec): JsonRenderSpec | null {
  return isRenderableSpec(spec) ? (spec as JsonRenderSpec) : null
}

function titleFromSpec(spec: JsonRenderSpec): string | undefined {
  const rootEl = spec.elements[spec.root]
  if (rootEl?.type === 'Card') {
    const title = rootEl.props?.title
    if (typeof title === 'string' && title.trim()) return title.trim()
  }
  return undefined
}

function pendingPatchLine(text: string, streaming: boolean): boolean {
  if (!streaming) return false
  const lastLine = text.split('\n').pop()?.trim() ?? ''
  return (
    lastLine.startsWith('{') &&
    /"op"\s*:/.test(lastLine) &&
    !lastLine.endsWith('}')
  )
}

function buildSplit(
  proseLines: string[],
  spec: Spec,
  patchCount: number,
  sourceText: string,
  options?: { streaming?: boolean },
): InlineCanvasSplit {
  const streaming = options?.streaming ?? false
  if (patchCount === 0) {
    return { prose: sourceText, canvas: null, canvasLoading: false }
  }

  const canvas = asJsonRenderSpec(spec)
  return {
    prose: proseLines.join('\n').trim(),
    canvas,
    canvasTitle: canvas ? titleFromSpec(canvas) : undefined,
    canvasLoading:
      streaming && !canvas && (pendingPatchLine(sourceText, streaming) || patchCount > 0),
  }
}

/** True when the assistant text looks like inline SpecStream output (JSONL patches). */
export function looksLikeInlineCanvasStream(text: string): boolean {
  if (text.includes('```spec')) return true
  return /^\s*\{"op"\s*:\s*"(?:add|replace|remove|move|copy)"/m.test(text)
}

/** Incremental inline SpecStream compiler for streaming assistant messages. */
export class InlineCanvasStreamCompiler {
  private proseLines: string[] = []
  private specCompiler = createSpecStreamCompiler<Spec>()
  private patchCount = 0
  private processedLength = 0
  private lastFullText = ''

  private parser = createMixedStreamParser({
    onText: (line) => {
      this.proseLines.push(line)
    },
    onPatch: (patch) => {
      this.specCompiler.push(`${JSON.stringify(patch)}\n`)
      this.patchCount += 1
    },
  })

  reset(): void {
    this.proseLines = []
    this.specCompiler.reset()
    this.patchCount = 0
    this.processedLength = 0
    this.lastFullText = ''
    this.parser = createMixedStreamParser({
      onText: (line) => {
        this.proseLines.push(line)
      },
      onPatch: (patch) => {
        this.specCompiler.push(`${JSON.stringify(patch)}\n`)
        this.patchCount += 1
      },
    })
  }

  /** Prefix-safe sync: only pushes the new suffix when text grows. */
  sync(fullText: string, options?: { streaming?: boolean }): InlineCanvasSplit {
    const streaming = options?.streaming ?? false

    if (
      fullText.length < this.processedLength ||
      (this.lastFullText.length > 0 && !fullText.startsWith(this.lastFullText))
    ) {
      this.reset()
    }

    const delta = fullText.slice(this.processedLength)
    if (delta.length > 0) {
      this.parser.push(delta)
      this.processedLength = fullText.length
      this.lastFullText = fullText
    }

    if (!streaming) {
      this.parser.flush()
    }

    return this.snapshot(fullText, options)
  }

  flush(fullText: string, options?: { streaming?: boolean }): InlineCanvasSplit {
    this.parser.flush()
    return this.snapshot(fullText, options)
  }

  snapshot(fullText: string, options?: { streaming?: boolean }): InlineCanvasSplit {
    return buildSplit(
      this.proseLines,
      this.specCompiler.getResult(),
      this.patchCount,
      fullText,
      options,
    )
  }
}

export function createInlineCanvasStreamCompiler(): InlineCanvasStreamCompiler {
  return new InlineCanvasStreamCompiler()
}

/** Split inline-mode assistant output into markdown prose and a compiled json-render spec. */
export function splitInlineCanvasMessage(
  text: string,
  options?: { streaming?: boolean },
): InlineCanvasSplit {
  const compiler = createInlineCanvasStreamCompiler()
  return compiler.sync(text, options)
}
