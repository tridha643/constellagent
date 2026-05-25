import { describe, expect, it } from 'bun:test'
import {
  createInlineCanvasStreamCompiler,
  splitInlineCanvasMessage,
  looksLikeInlineCanvasStream,
} from './json-canvas-inline'

const inlineExample = `Here's your dashboard:

{"op":"add","path":"/root","value":"card-1"}
{"op":"add","path":"/elements/card-1","value":{"type":"Card","props":{"title":"Project Status"},"children":["badge-1"]}}
{"op":"add","path":"/elements/badge-1","value":{"type":"Badge","props":{"label":"Active"}}}`

describe('json-canvas-inline', () => {
  it('detects inline SpecStream output', () => {
    expect(looksLikeInlineCanvasStream(inlineExample)).toBe(true)
    expect(looksLikeInlineCanvasStream('Just plain markdown.')).toBe(false)
  })

  it('splits prose from JSONL patches and compiles a renderable spec', () => {
    const result = splitInlineCanvasMessage(inlineExample)
    expect(result.prose).toBe("Here's your dashboard:")
    expect(result.canvas?.root).toBe('card-1')
    expect(result.canvas?.elements['badge-1']?.type).toBe('Badge')
    expect(result.canvasTitle).toBe('Project Status')
    expect(result.canvasLoading).toBe(false)
  })

  it('compiles a Callout nested in a Card (realistic deploy-status example)', () => {
    const example = `Deploy finished — here's the summary:

{"op":"add","path":"/root","value":"card-1"}
{"op":"add","path":"/elements/card-1","value":{"type":"Card","props":{"title":"Deploy"},"children":["note-1"]}}
{"op":"add","path":"/elements/note-1","value":{"type":"Callout","props":{"variant":"success","title":"Live","text":"v2.3.1 is serving 100% of traffic."}}}`
    const result = splitInlineCanvasMessage(example)
    expect(result.prose).toBe("Deploy finished — here's the summary:")
    expect(result.canvas?.elements['note-1']?.type).toBe('Callout')
    expect(result.canvas?.elements['note-1']?.props?.variant).toBe('success')
    expect(result.canvasLoading).toBe(false)
  })

  it('returns original text when no patches are present', () => {
    const text = 'No UI needed — BTC stands for Bitcoin.'
    expect(splitInlineCanvasMessage(text)).toEqual({
      prose: text,
      canvas: null,
      canvasLoading: false,
    })
  })

  it('compiles incrementally as prose and patch lines arrive in chunks', () => {
    const compiler = createInlineCanvasStreamCompiler()
    const chunk1 = "Here's your dashboard:\n\n"
    const chunk2 =
      '{"op":"add","path":"/root","value":"card-1"}\n{"op":"add","path":"/elements/card-1","value":{"type":"Card","props":{"title":"Project Status"},"children":["badge-1"]}}'

    const mid = compiler.sync(chunk1, { streaming: true })
    expect(mid.prose.trim()).toBe("Here's your dashboard:")
    expect(mid.canvas).toBeNull()
    expect(mid.canvasLoading).toBe(false)

    const done = compiler.sync(chunk1 + chunk2, { streaming: false })
    expect(done.canvas?.root).toBe('card-1')
    expect(done.canvasTitle).toBe('Project Status')
    expect(done.canvasLoading).toBe(false)
  })

  it('only processes new suffix on prefix-safe append', () => {
    const compiler = createInlineCanvasStreamCompiler()
    const first = "Intro\n\n"
    const second =
      '{"op":"add","path":"/root","value":"card-1"}\n{"op":"add","path":"/elements/card-1","value":{"type":"Card","props":{"title":"Status"},"children":[]}}'

    compiler.sync(first, { streaming: true })
    const result = compiler.sync(first + second, { streaming: false })

    expect(result.prose).toBe('Intro')
    expect(result.canvas?.root).toBe('card-1')
  })
})
