import { describe, expect, it } from 'bun:test'
import {
  CALLOUT_VARIANTS,
  CONSTELL_OWNED_COMPONENT_TYPES,
  constellComponentPropSchemas,
  jsonCanvasCatalog,
  JSON_CANVAS_INLINE_PROMPT,
} from './json-canvas-catalog'

/**
 * Contract tests for the canvas catalog itself. These lock the *available surface* the model
 * is told about (component names, the inline prompt) and the per-component prop schemas the
 * validator relies on, so a future catalog edit can't silently drop a type or change a prop
 * shape out from under `json-canvas-validate.ts`.
 */
describe('json-canvas-catalog', () => {
  it('exposes every constellagent-owned component plus the shadcn imports', () => {
    const names = new Set(jsonCanvasCatalog.componentNames)
    for (const owned of ['Card', 'Stack', 'Text', 'Callout', 'Metric', 'Badge', 'Divider', 'FilePathList']) {
      expect(names.has(owned)).toBe(true)
    }
    for (const shadcn of ['Grid', 'Heading', 'Button', 'Table', 'Progress', 'Alert']) {
      expect(names.has(shadcn)).toBe(true)
    }
  })

  it('limits CONSTELL_OWNED_COMPONENT_TYPES to schemas we control (no shadcn types)', () => {
    const owned = new Set(CONSTELL_OWNED_COMPONENT_TYPES)
    expect(owned.has('Callout')).toBe(true)
    expect(owned.has('Metric')).toBe(true)
    // shadcn props accept binding expressions, so they must stay out of the eager prop check.
    expect(owned.has('Table')).toBe(false)
    expect(owned.has('Alert')).toBe(false)
    expect([...owned].every((type) => type in constellComponentPropSchemas)).toBe(true)
  })

  it('documents the Callout component in the inline prompt so the model can emit it', () => {
    expect(JSON_CANVAS_INLINE_PROMPT).toContain('Callout')
  })

  it('keeps CALLOUT_VARIANTS in sync with the Callout prop schema', () => {
    for (const variant of CALLOUT_VARIANTS) {
      expect(
        constellComponentPropSchemas.Callout.safeParse({ text: 'x', variant }).success,
      ).toBe(true)
    }
    expect(constellComponentPropSchemas.Callout.safeParse({ text: 'x', variant: 'nope' }).success).toBe(
      false,
    )
  })

  describe('per-component prop schemas accept valid props and reject malformed ones', () => {
    it('Callout requires text and treats variant/title as optional', () => {
      expect(constellComponentPropSchemas.Callout.safeParse({ text: 'hi' }).success).toBe(true)
      expect(
        constellComponentPropSchemas.Callout.safeParse({ text: 'hi', title: 'Note', variant: 'success' })
          .success,
      ).toBe(true)
      expect(constellComponentPropSchemas.Callout.safeParse({ title: 'no text' }).success).toBe(false)
    })

    it('Metric requires both label and value', () => {
      expect(constellComponentPropSchemas.Metric.safeParse({ label: 'A', value: '1' }).success).toBe(true)
      expect(constellComponentPropSchemas.Metric.safeParse({ label: 'A' }).success).toBe(false)
    })

    it('FilePathList requires a non-empty string array', () => {
      expect(constellComponentPropSchemas.FilePathList.safeParse({ paths: ['a.ts'] }).success).toBe(true)
      expect(constellComponentPropSchemas.FilePathList.safeParse({ paths: [] }).success).toBe(false)
    })
  })

  it('validates a full Callout spec and rejects an unknown component type', () => {
    expect(
      jsonCanvasCatalog.validate({
        root: 'c',
        elements: { c: { type: 'Callout', props: { text: 'Heads up', variant: 'warning' }, children: [] } },
      }).success,
    ).toBe(true)
    expect(
      jsonCanvasCatalog.validate({
        root: 'x',
        elements: { x: { type: 'NotAComponent', props: {}, children: [] } },
      }).success,
    ).toBe(false)
  })
})
