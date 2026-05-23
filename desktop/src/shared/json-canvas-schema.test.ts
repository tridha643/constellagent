import { describe, expect, it } from 'bun:test'
import {
  assertCodexCompatibleJsonSchema,
  assertCodexStrictSchema,
  detectCanvasIntent,
  normalizeCanvasOutput,
  parsePartialRenderJsonCanvasFromText,
  parseRenderJsonCanvasFromText,
  parseRenderJsonCanvasParams,
  renderJsonCanvasOutputSchema,
} from './json-canvas-schema'

const validPayload = {
  title: 'Revenue',
  canvas: {
    root: 'card-1',
    elements: {
      'card-1': {
        type: 'Card',
        props: { title: 'Revenue' },
        children: ['m1'],
      },
      m1: { type: 'Metric', props: { label: 'Total', value: '$100' } },
    },
  },
}

const flatCodexPayload = {
  title: 'Revenue',
  description: '',
  root: 'card-1',
  elementsJson: JSON.stringify({
    'card-1': {
      type: 'Card',
      props: { title: 'Revenue' },
      children: ['m1'],
    },
    m1: { type: 'Metric', props: { label: 'Total', value: '$100' } },
  }),
}

describe('json-canvas-schema', () => {
  it('validates a well-formed canvas payload', () => {
    expect(parseRenderJsonCanvasParams(validPayload)).toEqual(validPayload)
  })

  it('rejects missing canvas root', () => {
    expect(parseRenderJsonCanvasParams({ canvas: { elements: {} } })).toBeNull()
  })

  it('parses JSON from json_canvas fenced blocks', () => {
    const text = '```json_canvas\n' + JSON.stringify(validPayload) + '\n```'
    expect(parseRenderJsonCanvasFromText(text)).toEqual(validPayload)
  })

  it('parses bare JSON text', () => {
    expect(parseRenderJsonCanvasFromText(JSON.stringify(validPayload))).toEqual(validPayload)
  })

  it('normalizes flat Codex output into RenderJsonCanvasParams', () => {
    expect(normalizeCanvasOutput(flatCodexPayload)).toEqual(validPayload)
  })

  it('parses flat Codex JSON from assistant text', () => {
    expect(parseRenderJsonCanvasFromText(JSON.stringify(flatCodexPayload))).toEqual(validPayload)
  })

  it('exports a flat strict-safe Codex output schema', () => {
    const schema = renderJsonCanvasOutputSchema()
    expect(schema.type).toBe('object')
    expect(schema.properties).toBeTruthy()
    expect(schema['$schema']).toBeUndefined()
    expect(() => assertCodexCompatibleJsonSchema(schema)).not.toThrow()
    expect(() => assertCodexStrictSchema(schema)).not.toThrow()
    const props = schema.properties as Record<string, unknown>
    expect(Object.keys(props).sort()).toEqual(['description', 'elementsJson', 'root', 'title'])
  })

  it('parses partial nested canvas JSON while streaming', () => {
    const partial =
      '{"title":"Revenue","canvas":{"root":"card-1","elements":{"card-1":{"type":"Card","props":{"title":"Revenue"},"children":["m1"]},"m1":{"type":"Metric","props":{"label":"Total","value":"$'
    const parsed = parsePartialRenderJsonCanvasFromText(partial)
    expect(parsed?.canvas.root).toBe('card-1')
    expect(parsed?.canvas.elements['card-1']?.type).toBe('Card')
  })

  it('detects canvas intent from natural language', () => {
    expect(detectCanvasIntent('render something using the canvas')).toBe(true)
    expect(detectCanvasIntent('build a dashboard from Linear issues')).toBe(true)
    expect(detectCanvasIntent('fix this TypeScript error')).toBe(false)
  })
})
