export interface BrowserBoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserSourceMetadata {
  file?: string
  line?: number
  column?: number
  component?: string
}

export interface BrowserSourceSnippet {
  filePath: string
  startLine: number
  endLine: number
  text: string
}

export interface SelectedComponentContext {
  kind: 'browser-selected-component'
  url: string
  title?: string
  tag: string
  text: string
  id?: string
  className?: string
  role?: string
  ariaLabel?: string
  domPath: string
  attributes: Record<string, string>
  boundingBox: BrowserBoundingBox
  nearbyText: string[]
  agentMetadata: BrowserSourceMetadata
  sourceSnippet?: BrowserSourceSnippet
  timestamp: number
}

export type BrowserMutationType = 'move' | 'resize' | 'style'

export interface ComponentMutationContext {
  kind: 'browser-component-mutation'
  mutationType: BrowserMutationType
  before: SelectedComponentContext
  after: SelectedComponentContext
  changedCssProperties: Record<string, string>
  boundingBoxBefore: BrowserBoundingBox
  boundingBoxAfter: BrowserBoundingBox
  generatedDelta: string
  timestamp: number
}

export interface BrowserContextStatus {
  enabled: boolean
  connected: boolean
  port: number
  targetUrl?: string
  error?: string
}

export type BrowserContextEvent =
  | { type: 'selected'; component: SelectedComponentContext }
  | { type: 'mutation'; mutation: ComponentMutationContext }
