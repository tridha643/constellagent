import { pathFromInput, queryFromInput } from './tool-input-path'

function hasShellInput(input: unknown): boolean {
  if (typeof input === 'string') return input.trim().length > 0
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Record<string, unknown>
    return typeof record.command === 'string' && record.command.trim().length > 0
  }
  return false
}

/** Registry key for a harness tool name + payload (no React imports). */
export function classifyToolRegistryKey(
  toolName: string,
  label: string,
  input: unknown,
  hasFileChangeOutput: boolean,
): string | undefined {
  if (hasFileChangeOutput) return 'apply_patch'

  const name = toolName.toLowerCase()
  if (name === 'todowrite' || name === 'todo_list' || name === 'todo') return 'todowrite'
  const path = pathFromInput(input)
  const query = queryFromInput(input)

  if (/(?:^|[._-])(?:shell|bash|terminal|command|exec|run)(?:$|[._-])/.test(name) || hasShellInput(input)) {
    return 'shell'
  }
  if (/(?:^|[._-])(?:delete|remove|unlink)(?:$|[._-])/.test(name)) return 'apply_patch'
  if (/(?:^|[._-])(?:write|create|touch)(?:$|[._-])/.test(name)) return 'write'
  if (
    /(?:^|[._-])(?:read|cat|view|open_file)(?:$|[._-])/.test(name) ||
    (path && /read|view|cat/i.test(label))
  ) {
    return 'read'
  }
  if (/(?:^|[._-])(?:list|ls|glob|dir|tree)(?:$|[._-])/.test(name)) return 'list'
  if (/(?:^|[._-])(?:grep|rg|ripgrep|search|find)(?:$|[._-])/.test(name) || query) {
    return name.includes('web') ? 'web_search' : 'grep'
  }
  if (
    /(?:^|[._-])(?:edit|patch|replace|diff|apply)(?:$|[._-])/.test(name) ||
    (path && /edit|wrote|patch|replace/i.test(label))
  ) {
    return 'apply_patch'
  }
  if (path) {
    if (/write|wrote|create/i.test(label)) return 'write'
    if (/read/i.test(label)) return 'read'
    return 'apply_patch'
  }
  return undefined
}
