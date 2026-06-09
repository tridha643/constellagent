/**
 * Shared types for the Agentation integration.
 *
 * Agentation is a dev-time annotation toolbar embedded in Browser tabs via
 * `<Agentation endpoint="…"/>`. constellagent embeds the HTTP/SSE server
 * (agentation-mcp `startHttpServer`) in main and mirrors events to the renderer.
 */

/**
 * Electron session partition for the Agentation Browser webview. Scoped to its
 * own partition so the main process can relax CSP for the injected annotation
 * guest (which fetches the embedded server cross-origin) without affecting the
 * app window's own strict CSP.
 */
export const AGENTATION_WEBVIEW_PARTITION = 'persist:agentation-browser'

export type AgentationAnnotationKind = 'feedback' | 'placement' | 'rearrange'
export type AgentationAnnotationStatus = 'pending' | 'acknowledged' | 'resolved' | 'dismissed'
export type AgentationThreadRole = 'human' | 'agent'

export interface AgentationThreadMessage {
  id: string
  role: AgentationThreadRole
  content: string
  timestamp: number
}

/** One element an Agentation toolbar user annotated in the Browser webview. */
export interface AgentationAnnotation {
  id: string
  comment: string
  elementPath?: string
  timestamp?: number
  x?: number
  y?: number
  element?: string
  url?: string
  reactComponents?: string[] | string
  cssClasses?: string
  computedStyles?: string
  accessibility?: string
  nearbyText?: string
  selectedText?: string
  boundingBox?: { x: number; y: number; width: number; height: number }
  kind?: AgentationAnnotationKind
  sessionId?: string
  status?: AgentationAnnotationStatus
  thread?: AgentationThreadMessage[]
  resolved?: boolean
  placement?: {
    componentType: string
    width: number
    height: number
    scrollY: number
    text?: string
  }
  rearrange?: {
    selector: string
    label: string
    tagName: string
    originalRect: { x: number; y: number; width: number; height: number }
    currentRect: { x: number; y: number; width: number; height: number }
  }
}

export type AgentationSessionStatus = 'active' | 'approved' | 'closed'

/** A grouping of annotations the server reports under one session. */
export interface AgentationSession {
  id: string
  title?: string
  url?: string
  createdAt?: number | string
  updatedAt?: string
  status?: AgentationSessionStatus
  annotations: AgentationAnnotation[]
}

/** Connection state of the embedded / configured Agentation HTTP server. */
export interface AgentationStatus {
  connected: boolean
  streaming: boolean
  endpoint: string
  embedded?: boolean
  reconnecting?: boolean
  error?: string
}

export interface AgentationActionRequested {
  sessionId: string
  output: string
  annotations: AgentationAnnotation[]
  timestamp?: string
}

/**
 * Event forwarded from main → renderer over `AGENTATION_EVENT`.
 */
export type AgentationEvent =
  | { type: 'status'; status: AgentationStatus }
  | { type: 'annotation.created'; annotation: AgentationAnnotation }
  | { type: 'annotation.updated'; annotation: AgentationAnnotation }
  | { type: 'annotation.deleted'; annotationId: string }
  | { type: 'session.created'; session: AgentationSession }
  | { type: 'session.updated'; session: AgentationSession }
  | { type: 'session.closed'; sessionId: string }
  | { type: 'thread.message'; annotationId: string; message: AgentationThreadMessage }
  | { type: 'action.requested'; action: AgentationActionRequested }

/**
 * Render an annotation as markdown to paste to an agent.
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
  const components = annotation.reactComponents
  if (Array.isArray(components) && components.length) {
    details.push(`Components: ${components.join(' › ')}`)
  } else if (typeof components === 'string' && components.trim()) {
    details.push(`Components: ${components}`)
  }
  if (annotation.url) details.push(`URL: ${annotation.url}`)
  if (details.length) {
    lines.push('')
    for (const d of details) lines.push(`- ${d}`)
  }

  return lines.join('\n')
}
