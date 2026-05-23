import { describe, expect, it } from 'bun:test'
import {
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

  it('exports an OpenAI-compatible output schema object', () => {
    const schema = renderJsonCanvasOutputSchema()
    expect(schema).toBeTruthy()
    expect(typeof schema).toBe('object')
  })
})
