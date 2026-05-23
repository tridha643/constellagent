import { describe, expect, it } from 'bun:test'
import {
  extractLegacyCanvasFromAssistantText,
  normalizeAssistantMarkdown,
} from './normalize-markdown-canvas'

const nestedPayload = {
  title: 'Project Status',
  canvas: {
    root: 'root',
    elements: {
      root: { type: 'Card', props: { title: 'Project Status' }, children: ['badge-1'] },
      'badge-1': { type: 'Badge', props: { label: 'Active' } },
    },
  },
}

const flatPayload = {
  title: 'Project Status',
  description: '',
  root: 'root',
  elementsJson: JSON.stringify({
    root: { type: 'Card', props: { title: 'Project Status' }, children: ['badge-1'] },
    'badge-1': { type: 'Badge', props: { label: 'Active' } },
  }),
}

const inlineExample = `Updated layout:

{"op":"add","path":"/root","value":"root"}
{"op":"add","path":"/elements/root","value":{"type":"Card","props":{"title":"Project Status"},"children":["badge-1"]}}
{"op":"add","path":"/elements/badge-1","value":{"type":"Badge","props":{"label":"Active"}}}`

describe('normalize-markdown-canvas', () => {
  it('extracts inline SpecStream prose and canvas', () => {
    const result = normalizeAssistantMarkdown(inlineExample)
    expect(result.markdown).toBe('Updated layout:')
    expect(result.canvas?.root).toBe('root')
    expect(result.canvasTitle).toBe('Project Status')
  })

  it('extracts bare nested legacy canvas JSON from assistant text', () => {
    const text = JSON.stringify(nestedPayload)
    const result = normalizeAssistantMarkdown(text)
    expect(result.markdown).toBe('')
    expect(result.canvas).toEqual(nestedPayload.canvas)
    expect(result.canvasTitle).toBe('Project Status')
  })

  it('extracts flat Codex legacy canvas JSON from assistant text', () => {
    const text = JSON.stringify(flatPayload)
    const result = normalizeAssistantMarkdown(text)
    expect(result.markdown).toBe('')
    expect(result.canvas?.root).toBe('root')
    expect(result.canvasTitle).toBe('Project Status')
  })

  it('extracts canvas from json_canvas fenced blocks and keeps prose', () => {
    const text = `Updated layout:\n\`\`\`json_canvas\n${JSON.stringify(nestedPayload)}\n\`\`\``
    const result = normalizeAssistantMarkdown(text)
    expect(result.markdown).toBe('Updated layout:')
    expect(result.canvas).toEqual(nestedPayload.canvas)
  })

  it('leaves normal markdown untouched', () => {
    const text = 'Here is a **table**:\n\n| A | B |\n| --- | --- |'
    expect(normalizeAssistantMarkdown(text)).toEqual({
      markdown: text,
      canvas: null,
      canvasLoading: false,
    })
  })

  it('normalizes tables after stripping legacy canvas JSON', () => {
    const text = `${JSON.stringify(flatPayload)}\n\n| A | B | C |\n| --- |`
    const result = normalizeAssistantMarkdown(text)
    expect(result.canvas?.root).toBe('root')
    expect(result.markdown).toContain('| A | B | C |')
    expect(result.markdown).toContain('| --- | --- | --- |')
  })

  it('flags streaming legacy canvas-shaped JSON before it parses', () => {
    const partial = '{"title":"Project Status","root":"root","elementsJson":"{\\"root\\":{\\"type\\":\\"Card\\"'
    const result = normalizeAssistantMarkdown(partial, { streaming: true })
    expect(result.canvas).toBeNull()
    expect(result.canvasLoading).toBe(true)
    expect(result.markdown).toBe('')
  })
})
