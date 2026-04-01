declare module '@anthropic-ai/claude-code' {
  interface QueryOptions {
    prompt: string
    systemPrompt?: string
    options?: {
      maxTurns?: number
      [key: string]: unknown
    }
  }

  interface TextBlock {
    type: 'text'
    text: string
  }

  interface AssistantMessage {
    type: 'assistant'
    message?: {
      content: Array<TextBlock | { type: string; [key: string]: unknown }>
    }
  }

  interface ResultMessage {
    type: 'result'
    result: string | unknown
  }

  type QueryMessage = AssistantMessage | ResultMessage | { type: string; message?: { content?: Array<{ type: string; text?: string; [key: string]: unknown }> }; result?: unknown; [key: string]: unknown }

  export function query(options: QueryOptions): AsyncIterable<QueryMessage>
}
