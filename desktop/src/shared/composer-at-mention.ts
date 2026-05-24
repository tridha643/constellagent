import type { QuickOpenSearchItem } from './quick-open-types'

export interface ActiveAtToken {
  readonly query: string
  readonly from: number
  readonly to: number
}

export interface ConductorFileMention {
  readonly id: string
  readonly relativePath: string
  readonly absolutePath: string
}

/** Detects a workspace file `@` mention being typed at the cursor. */
export function parseActiveAtToken(value: string, cursorPos: number): ActiveAtToken | null {
  const end = Math.min(Math.max(0, cursorPos), value.length)
  const before = value.slice(0, end)
  const atIdx = before.lastIndexOf('@')
  if (atIdx < 0) {
    return null
  }
  if (atIdx > 0) {
    const prev = value[atIdx - 1]
    if (prev !== undefined && !/\s/.test(prev)) {
      return null
    }
  }
  const segment = value.slice(atIdx, end)
  if (/\s/.test(segment)) {
    return null
  }
  return { query: segment, from: atIdx, to: end }
}

export function atMentionSearchQuery(atQuery: string): string {
  return atQuery.slice(1)
}

export function atMentionParentDir(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash >= 0 ? relativePath.slice(0, slash + 1) : ''
}

export function atMentionFileName(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash >= 0 ? relativePath.slice(slash + 1) : relativePath
}

export function createConductorFileMention(
  item: Pick<QuickOpenSearchItem, 'path' | 'relativePath'>,
): ConductorFileMention {
  return {
    id: crypto.randomUUID(),
    relativePath: item.relativePath,
    absolutePath: item.path,
  }
}

/** Legacy text insert — prefer structured {@link ConductorFileMention} chips in the composer UI. */
export function formatAtMentionInsert(item: Pick<QuickOpenSearchItem, 'relativePath'>): string {
  return `@${item.relativePath} `
}

export function serializeComposerTextWithFileMentions(
  text: string,
  mentions: readonly ConductorFileMention[],
): string {
  const trimmed = text.trim()
  const mentionText = mentions.map((mention) => `@${mention.relativePath}`).join(' ')
  if (!trimmed) return mentionText
  if (!mentionText) return trimmed
  return `${trimmed} ${mentionText}`
}

export function hasComposerDraftInput(
  text: string,
  mentions: readonly ConductorFileMention[],
): boolean {
  return text.trim().length > 0 || mentions.length > 0
}

/** When the caret is collapsed at the start of the draft textarea, backspace removes the last file chip. */
export function shouldBackspaceRemoveLastFileMention(
  selectionStart: number,
  selectionEnd: number,
  mentionCount: number,
): boolean {
  return mentionCount > 0 && selectionStart === 0 && selectionEnd === 0
}
