import { jsonCanvasCatalog, constellComponentPropSchemas } from './json-canvas-catalog'

/**
 * Structural / referential-integrity validation for json-render canvas specs.
 *
 * The loose `JsonRenderSpecSchema` and the catalog's own Zod `validate()` only check
 * the *shape* of each element (and its props/type). Neither catches the failures that
 * actually produce a silently-blank canvas at render time: a `root` that points at a
 * missing element, `children` referencing ids that were never defined, or a cycle that
 * would recurse forever. This module fills that gap and emits diagnostics with exact
 * JSON-pointer paths plus actionable fix suggestions so users (and models) can self-correct.
 */

export type CanvasDiagnosticSeverity = 'error' | 'warning'

export type CanvasDiagnosticCode =
  | 'spec-not-object'
  | 'elements-not-object'
  | 'missing-root'
  | 'root-not-found'
  | 'element-not-object'
  | 'empty-type'
  | 'unknown-type'
  | 'children-not-array'
  | 'dangling-child'
  | 'cyclic-reference'
  | 'orphan-element'
  | 'invalid-props'

export interface CanvasDiagnostic {
  severity: CanvasDiagnosticSeverity
  code: CanvasDiagnosticCode
  /** Plain-language description of what is wrong. */
  message: string
  /** JSON-pointer-style path into the spec, e.g. `/elements/card-1/children/0`. */
  path: string
  /** Concrete, actionable hint for fixing the problem, when one can be derived. */
  suggestion?: string
}

export interface CanvasValidationResult {
  /** No `error`-severity diagnostics. `warning`s may still be present. */
  valid: boolean
  /** Root resolves to an element with a non-empty `type` — enough to attempt a render. */
  renderable: boolean
  diagnostics: CanvasDiagnostic[]
}

let cachedKnownTypes: ReadonlySet<string> | null = null

/** Component types the canvas registry can render — single source of truth is the catalog. */
export function getKnownCanvasComponentTypes(): ReadonlySet<string> {
  if (!cachedKnownTypes) cachedKnownTypes = new Set(jsonCanvasCatalog.componentNames)
  return cachedKnownTypes
}

function quoteList(items: readonly string[]): string {
  return items.map((item) => `"${item}"`).join(', ')
}

/** Classic Levenshtein edit distance — used only for "did you mean" hints. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i += 1) {
    const curr = [i + 1]
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1
      curr.push(Math.min(curr[j]! + 1, prev[j + 1]! + 1, prev[j]! + cost))
    }
    prev = curr
  }
  return prev[b.length]!
}

/** Nearest candidate within a forgiving threshold, or undefined when nothing is close. */
function nearest(target: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined
  let bestDist = Infinity
  const lower = target.toLowerCase()
  for (const candidate of candidates) {
    const dist = levenshtein(lower, candidate.toLowerCase())
    if (dist < bestDist) {
      bestDist = dist
      best = candidate
    }
  }
  if (best && bestDist <= Math.max(2, Math.floor(target.length * 0.5))) return best
  return undefined
}

function suggestId(missing: string, ids: readonly string[]): string {
  if (!ids.length) return 'No elements are defined.'
  const near = nearest(missing, ids)
  return near
    ? `Did you mean "${near}"? Available ids: ${quoteList(ids)}.`
    : `Available ids: ${quoteList(ids)}.`
}

/**
 * json-render lets prop values be state-binding expressions (e.g. `"$state.count"`) or
 * `DynamicValue`/template objects that are resolved at render time. Those legitimately fail
 * a literal Zod check, so we must not flag them. A leading `$` / `{{` marks a string binding;
 * any non-primitive (object/array) is treated as a possible expression and left alone.
 */
function looksLikeBinding(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith('$') || value.startsWith('{{')
  return value !== null && typeof value === 'object'
}

/** Walk a Zod issue path into the raw props to recover the offending value. */
function valueAtPath(root: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let current: unknown = root
  for (const key of path) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<PropertyKey, unknown>)[key as keyof object]
  }
  return current
}

/**
 * Validate an element's `props` against its component's Zod schema and translate any failures
 * into canvas diagnostics with exact `/elements/<id>/props/...` paths. Only constellagent-owned
 * components are checked (their schemas are literal-valued); binding expressions are skipped so
 * they never produce false positives. A genuinely-missing required prop is an `error` (it breaks
 * the render); a present-but-wrong value is a `warning` so it can't regress a previously-valid spec.
 */
function collectPropDiagnostics(id: string, type: string, props: unknown): CanvasDiagnostic[] {
  const schema = constellComponentPropSchemas[type]
  if (!schema) return []
  const candidate = props === undefined ? {} : props
  const result = schema.safeParse(candidate)
  if (result.success) return []

  const diagnostics: CanvasDiagnostic[] = []
  for (const issue of result.error.issues) {
    const value = valueAtPath(candidate, issue.path)
    const field = issue.path.map((segment) => String(segment)).join('.')
    const path = `/elements/${id}/props${issue.path.map((segment) => `/${String(segment)}`).join('')}`
    const missingRequired = issue.code === 'invalid_type' && value === undefined
    // A present binding expression isn't malformed — skip everything except a missing required prop.
    if (!missingRequired && looksLikeBinding(value)) continue
    diagnostics.push({
      severity: missingRequired ? 'error' : 'warning',
      code: 'invalid-props',
      path,
      message: field
        ? `Element "${id}" has invalid prop "${field}": ${issue.message}`
        : `Element "${id}" has invalid props: ${issue.message}`,
      suggestion: missingRequired ? `Add a "${field}" value to props.` : undefined,
    })
  }
  return diagnostics
}

function getChildIds(element: unknown): string[] {
  if (!element || typeof element !== 'object') return []
  const children = (element as Record<string, unknown>).children
  if (!Array.isArray(children)) return []
  return children.filter((child): child is string => typeof child === 'string')
}

/** First back-edge found by DFS, or null when the element tree is acyclic. */
function findCycle(
  root: string,
  elements: Record<string, unknown>,
): { from: string; to: string } | null {
  const state = new Map<string, 'visiting' | 'done'>()
  let found: { from: string; to: string } | null = null

  const visit = (id: string): void => {
    if (found) return
    state.set(id, 'visiting')
    for (const child of getChildIds(elements[id])) {
      if (found) return
      if (!(child in elements)) continue
      const childState = state.get(child)
      if (childState === 'visiting') {
        found = { from: id, to: child }
        return
      }
      if (childState === undefined) visit(child)
    }
    state.set(id, 'done')
  }

  visit(root)
  return found
}

/** Element ids reachable from root by following `children` (cycle-safe). */
function collectReachable(root: string, elements: Record<string, unknown>): Set<string> {
  const seen = new Set<string>()
  const stack = [root]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const child of getChildIds(elements[id])) {
      if (child in elements && !seen.has(child)) stack.push(child)
    }
  }
  return seen
}

function computeRenderable(spec: unknown): boolean {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return false
  const record = spec as Record<string, unknown>
  const root = record.root
  if (typeof root !== 'string' || !root.trim()) return false
  const elements = record.elements
  if (!elements || typeof elements !== 'object' || Array.isArray(elements)) return false
  const element = (elements as Record<string, unknown>)[root]
  if (!element || typeof element !== 'object') return false
  const type = (element as Record<string, unknown>).type
  return typeof type === 'string' && type.trim().length > 0
}

/**
 * Validate a canvas spec for structural and referential integrity.
 * Accepts `unknown` so it can be run directly on raw/streamed model output.
 */
export function validateJsonCanvasSpec(
  spec: unknown,
  options?: { knownTypes?: Iterable<string> },
): CanvasValidationResult {
  const diagnostics: CanvasDiagnostic[] = []
  const known = options?.knownTypes ? new Set(options.knownTypes) : getKnownCanvasComponentTypes()
  const knownList = [...known]

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    diagnostics.push({
      severity: 'error',
      code: 'spec-not-object',
      path: '/',
      message: 'Canvas spec must be a JSON object with `root` and `elements`.',
      suggestion: 'Wrap output as { "root": "<id>", "elements": { "<id>": { "type": "Card" } } }.',
    })
    return { valid: false, renderable: false, diagnostics }
  }

  const record = spec as Record<string, unknown>
  const root = record.root
  const elementsRaw = record.elements

  const elementsOk =
    !!elementsRaw && typeof elementsRaw === 'object' && !Array.isArray(elementsRaw)
  const elements = (elementsOk ? elementsRaw : {}) as Record<string, unknown>
  const elementIds = Object.keys(elements)

  if (!elementsOk) {
    diagnostics.push({
      severity: 'error',
      code: 'elements-not-object',
      path: '/elements',
      message: '`elements` must be an object mapping element ids to element definitions.',
      suggestion: 'Provide "elements": { "<id>": { "type": "Card", … } }.',
    })
  }

  const rootValid = typeof root === 'string' && root.trim().length > 0
  if (!rootValid) {
    diagnostics.push({
      severity: 'error',
      code: 'missing-root',
      path: '/root',
      message: '`root` must be a non-empty string naming the top-level element id.',
      suggestion: elementIds.length
        ? `Set root to one of: ${quoteList(elementIds)}.`
        : 'Add at least one element and point `root` at its id.',
    })
  } else if (elementsOk && !(root in elements)) {
    diagnostics.push({
      severity: 'error',
      code: 'root-not-found',
      path: '/root',
      message: `Root id "${root}" is not present in elements.`,
      suggestion: suggestId(root as string, elementIds),
    })
  }

  for (const id of elementIds) {
    const element = elements[id]
    const base = `/elements/${id}`
    if (!element || typeof element !== 'object' || Array.isArray(element)) {
      diagnostics.push({
        severity: 'error',
        code: 'element-not-object',
        path: base,
        message: `Element "${id}" must be an object with a "type".`,
      })
      continue
    }

    const elementRecord = element as Record<string, unknown>
    const type = elementRecord.type
    if (typeof type !== 'string' || type.trim().length === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'empty-type',
        path: `${base}/type`,
        message: `Element "${id}" is missing a non-empty "type".`,
        suggestion: `Use one of the known types: ${quoteList(knownList)}.`,
      })
    } else if (!known.has(type)) {
      const near = nearest(type, knownList)
      diagnostics.push({
        severity: 'warning',
        code: 'unknown-type',
        path: `${base}/type`,
        message: `Element "${id}" uses unknown component type "${type}".`,
        suggestion: near
          ? `Did you mean "${near}"? Known types: ${quoteList(knownList)}.`
          : `Known types: ${quoteList(knownList)}.`,
      })
    } else {
      // Type is a recognized component — check its props against the real contract.
      diagnostics.push(...collectPropDiagnostics(id, type, elementRecord.props))
    }

    const children = elementRecord.children
    if (children !== undefined) {
      if (!Array.isArray(children)) {
        diagnostics.push({
          severity: 'error',
          code: 'children-not-array',
          path: `${base}/children`,
          message: `Element "${id}" has "children" that is not an array of element ids.`,
          suggestion: 'Set "children" to an array of string element ids, e.g. ["row-1", "row-2"].',
        })
      } else {
        children.forEach((child, index) => {
          if (typeof child !== 'string') {
            diagnostics.push({
              severity: 'error',
              code: 'dangling-child',
              path: `${base}/children/${index}`,
              message: `Element "${id}" has a non-string child reference at index ${index}.`,
              suggestion: 'Child references must be string element ids.',
            })
          } else if (!(child in elements)) {
            diagnostics.push({
              severity: 'error',
              code: 'dangling-child',
              path: `${base}/children/${index}`,
              message: `Element "${id}" references child "${child}" which is not defined in elements.`,
              suggestion: suggestId(child, elementIds),
            })
          }
        })
      }
    }
  }

  const rootResolvable = rootValid && elementsOk && (root as string) in elements
  if (rootResolvable) {
    const cycle = findCycle(root as string, elements)
    if (cycle) {
      diagnostics.push({
        severity: 'error',
        code: 'cyclic-reference',
        path: `/elements/${cycle.from}/children`,
        message: `Cyclic reference: "${cycle.from}" eventually contains itself via "${cycle.to}".`,
        suggestion: 'Remove the back-reference so the element tree is acyclic.',
      })
    } else {
      const reachable = collectReachable(root as string, elements)
      for (const id of elementIds) {
        if (!reachable.has(id)) {
          diagnostics.push({
            severity: 'warning',
            code: 'orphan-element',
            path: `/elements/${id}`,
            message: `Element "${id}" is never referenced from root "${root}" and will not render.`,
            suggestion: `Add "${id}" to a parent's "children" array, or remove it.`,
          })
        }
      }
    }
  }

  const renderable = computeRenderable(spec)
  const valid = !diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  return { valid, renderable, diagnostics }
}

/** Compact, deterministic one-line-per-diagnostic rendering for error previews/logs. */
export function formatCanvasDiagnostics(diagnostics: readonly CanvasDiagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const tag = diagnostic.severity === 'error' ? 'error' : 'warn'
      const loc = diagnostic.path && diagnostic.path !== '/' ? ` ${diagnostic.path}` : ''
      const fix = diagnostic.suggestion ? ` ${diagnostic.suggestion}` : ''
      return `[${tag}]${loc}: ${diagnostic.message}${fix}`
    })
    .join('\n')
}
