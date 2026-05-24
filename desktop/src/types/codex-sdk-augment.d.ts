import type {
  AgentMessageItem,
  CommandExecutionItem,
  ErrorItem,
  FileChangeItem,
  McpToolCallItem,
  ReasoningItem,
  ThreadItem,
  TodoListItem,
  WebSearchItem,
} from '@openai/codex-sdk'
import type {
  CollabToolCallItem,
} from '../shared/codex-collab-types'

declare module '@openai/codex-sdk' {
  export type CollabToolCallThreadItem = CollabToolCallItem

  export type ThreadItem =
    | AgentMessageItem
    | ReasoningItem
    | CommandExecutionItem
    | FileChangeItem
    | McpToolCallItem
    | WebSearchItem
    | TodoListItem
    | ErrorItem
    | CollabToolCallItem
}
