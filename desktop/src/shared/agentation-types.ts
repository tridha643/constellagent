/**
 * Shared types for the Agentation integration.
 *
 * Agentation is a dev-time annotation toolbar the developer embeds in their own
 * app (`<Agentation endpoint="http://localhost:4747"/>`). Its `agentation-mcp`
 * companion runs a local HTTP/SSE server on :4747 that the toolbar POSTs
 * annotations to. constellagent's Agentation panel is a *reader* of that server:
 * it consumes the SSE event stream and lets the user send/resolve/dismiss
 * annotations.
 *
 * This is the typed replacement for the deleted `BrowserDomContext`.
 */

/** One element an Agentation toolbar user annotated in their own browser. */
export interface AgentationAnnotation {
  id: string
  /** The user's note about the element. */
  comment: string
  /** DOM path / selector for the annotated element. */
  elementPath?: string
  /** Epoch millis when the annotation was created. */
  timestamp?: number
  x?: number
  y?: number
  /** Short description of the element (tag/text preview). */
  element?: string
  /** Page URL the annotation was captured on. */
  url?: string
  /** React component display names in the element's ancestry (dev builds). */
  reactComponents?: string[]
  boundingBox?: { x: number; y: number; width: number; height: number }
  /** Toolbar interaction kind; defaults to feedback when absent. */
  kind?: 'feedback' | 'placement' | 'rearrange'
  /** Session this annotation belongs to (when grouped server-side). */
  sessionId?: string
  /** Set once resolved/dismissed back to Agentation. */
  resolved?: boolean
}

/** A grouping of annotations the server reports under one session. */
export interface AgentationSession {
  id: string
  /** Human label (often the page URL or a title). */
  title?: string
  url?: string
  createdAt?: number
  annotations: AgentationAnnotation[]
}

/** Connection state of the local agentation-mcp server. */
export interface AgentationStatus {
  /** True when :4747 responded to the probe. */
  connected: boolean
  /** Live SSE stream attached. */
  streaming: boolean
  /** The endpoint currently targeted. */
  endpoint: string
  /** Set when reconnecting after a dropped stream. */
  reconnecting?: boolean
  /** Last error message, if any (e.g. ECONNREFUSED). */
  error?: string
}

/**
 * Event forwarded from main → renderer over `AGENTATION_EVENT`. Mirrors the
 * agentation-mcp SSE event names plus a synthetic `status` event the service
 * emits on connect/disconnect/endpoint-change.
 */
export type AgentationEvent =
  | { type: 'status'; status: AgentationStatus }
  | { type: 'annotation.created'; annotation: AgentationAnnotation }
  | { type: 'annotation.updated'; annotation: AgentationAnnotation }
  | { type: 'annotation.deleted'; annotationId: string }
  | { type: 'session.created'; session: AgentationSession }

/**
 * Render an annotation as markdown to paste to an agent. Degrades gracefully
 * when optional fields (url, reactComponents, elementPath) are absent.
 */
export function annotationToMarkdown(annotation: AgentationAnnotation): string {
  const lines: string[] = []
  const kind = annotation.kind ?? 'feedback'
  const label =
    kind === 'placement' ? 'Placement annotation'
    : kind === 'rearrange' ? 'Rearrange annotation'
    : 'Feedback annotation'
  lines.push(`**${label}**`)

  const comment = annotation.comment?.trim()
  if (comment) lines.push('', comment)

  const details: string[] = []
  if (annotation.element) details.push(`Element: ${annotation.element}`)
  if (annotation.elementPath) details.push(`Path: \`${annotation.elementPath}\``)
  if (annotation.reactComponents?.length) {
    details.push(`Components: ${annotation.reactComponents.join(' › ')}`)
  }
  if (annotation.url) details.push(`URL: ${annotation.url}`)
  if (details.length) {
    lines.push('')
    for (const d of details) lines.push(`- ${d}`)
  }

  return lines.join('\n')
}
