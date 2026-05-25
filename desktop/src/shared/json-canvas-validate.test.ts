import { describe, expect, it } from 'bun:test'
import {
  formatCanvasDiagnostics,
  getKnownCanvasComponentTypes,
  validateJsonCanvasSpec,
  type CanvasDiagnosticCode,
} from './json-canvas-validate'

function codes(spec: unknown): CanvasDiagnosticCode[] {
  return validateJsonCanvasSpec(spec).diagnostics.map((d) => d.code)
}

const validSpec = {
  root: 'card-1',
  elements: {
    'card-1': { type: 'Card', props: { title: 'Revenue' }, children: ['stack-1'] },
    'stack-1': { type: 'Stack', children: ['metric-1', 'badge-1'] },
    'metric-1': { type: 'Metric', props: { label: 'Total', value: '$100' } },
    'badge-1': { type: 'Badge', props: { label: 'Active' } },
  },
}

describe('json-canvas-validate', () => {
  it('keeps the known-type set in sync with the catalog', () => {
    const known = getKnownCanvasComponentTypes()
    expect(known.has('Card')).toBe(true)
    expect(known.has('Metric')).toBe(true)
    expect(known.has('Table')).toBe(true)
    expect(known.has('DefinitelyNotAComponent')).toBe(false)
  })

  it('accepts a well-formed, fully-connected spec', () => {
    const result = validateJsonCanvasSpec(validSpec)
    expect(result.valid).toBe(true)
    expect(result.renderable).toBe(true)
    expect(result.diagnostics).toEqual([])
  })

  it('flags non-object specs', () => {
    expect(codes(null)).toEqual(['spec-not-object'])
    expect(codes('{}')).toEqual(['spec-not-object'])
    expect(codes([])).toEqual(['spec-not-object'])
    expect(validateJsonCanvasSpec(null).renderable).toBe(false)
  })

  it('reports a missing/empty root', () => {
    const result = validateJsonCanvasSpec({ root: '', elements: { a: { type: 'Card' } } })
    expect(result.valid).toBe(false)
    expect(result.renderable).toBe(false)
    expect(result.diagnostics[0]?.code).toBe('missing-root')
    expect(result.diagnostics[0]?.path).toBe('/root')
    expect(result.diagnostics[0]?.suggestion).toContain('"a"')
  })

  it('reports a root id that is absent from elements with a did-you-mean hint', () => {
    const result = validateJsonCanvasSpec({
      root: 'crd-1',
      elements: { 'card-1': { type: 'Card' } },
    })
    const diag = result.diagnostics.find((d) => d.code === 'root-not-found')
    expect(diag).toBeTruthy()
    expect(diag?.path).toBe('/root')
    expect(diag?.suggestion).toContain('Did you mean "card-1"')
    expect(result.renderable).toBe(false)
  })

  it('reports dangling child references with the exact path and available ids', () => {
    const result = validateJsonCanvasSpec({
      root: 'card-1',
      elements: {
        'card-1': { type: 'Card', children: ['ghost'] },
      },
    })
    const diag = result.diagnostics.find((d) => d.code === 'dangling-child')
    expect(diag).toBeTruthy()
    expect(diag?.path).toBe('/elements/card-1/children/0')
    expect(diag?.message).toContain('"ghost"')
    expect(diag?.suggestion).toContain('"card-1"')
    // Root itself is fine, so the spec is still renderable even with a bad child.
    expect(result.renderable).toBe(true)
    expect(result.valid).toBe(false)
  })

  it('reports non-string child references', () => {
    const result = validateJsonCanvasSpec({
      root: 'card-1',
      elements: { 'card-1': { type: 'Card', children: [42] } },
    })
    const diag = result.diagnostics.find((d) => d.code === 'dangling-child')
    expect(diag?.path).toBe('/elements/card-1/children/0')
    expect(diag?.message).toContain('non-string')
  })

  it('reports children that are not arrays', () => {
    expect(
      codes({ root: 'a', elements: { a: { type: 'Card', children: 'b' } } }),
    ).toContain('children-not-array')
  })

  it('warns on unknown component types with a nearest-match suggestion', () => {
    const result = validateJsonCanvasSpec({
      root: 'a',
      elements: { a: { type: 'Crad' } },
    })
    const diag = result.diagnostics.find((d) => d.code === 'unknown-type')
    expect(diag?.severity).toBe('warning')
    expect(diag?.path).toBe('/elements/a/type')
    expect(diag?.suggestion).toContain('Did you mean "Card"')
    // Unknown type is a warning only — still "valid" and renderable.
    expect(result.valid).toBe(true)
    expect(result.renderable).toBe(true)
  })

  it('errors on empty/missing element type', () => {
    expect(codes({ root: 'a', elements: { a: { props: {} } } })).toContain('empty-type')
    expect(codes({ root: 'a', elements: { a: { type: '  ' } } })).toContain('empty-type')
  })

  it('detects cyclic references and skips orphan noise', () => {
    const result = validateJsonCanvasSpec({
      root: 'a',
      elements: {
        a: { type: 'Card', children: ['b'] },
        b: { type: 'Stack', children: ['a'] },
      },
    })
    const diag = result.diagnostics.find((d) => d.code === 'cyclic-reference')
    expect(diag).toBeTruthy()
    expect(diag?.severity).toBe('error')
    expect(result.valid).toBe(false)
    // A cycle short-circuits orphan analysis to avoid misleading double-reports.
    expect(result.diagnostics.some((d) => d.code === 'orphan-element')).toBe(false)
  })

  it('warns about orphan elements unreachable from root', () => {
    const result = validateJsonCanvasSpec({
      root: 'a',
      elements: {
        a: { type: 'Card', children: [] },
        stray: { type: 'Badge', props: { label: 'unused' } },
      },
    })
    const diag = result.diagnostics.find((d) => d.code === 'orphan-element')
    expect(diag?.severity).toBe('warning')
    expect(diag?.path).toBe('/elements/stray')
    // Orphans don't block rendering of the connected tree.
    expect(result.valid).toBe(true)
    expect(result.renderable).toBe(true)
  })

  it('formats diagnostics as compact, deterministic lines', () => {
    const result = validateJsonCanvasSpec({
      root: 'card-1',
      elements: { 'card-1': { type: 'Card', children: ['ghost'] } },
    })
    const formatted = formatCanvasDiagnostics(result.diagnostics)
    expect(formatted).toContain('[error] /elements/card-1/children/0:')
    expect(formatted).toContain('"ghost"')
  })
})
