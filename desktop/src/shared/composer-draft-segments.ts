import { isConductorHostSlashName } from './conductor-composer-commands'

export type ComposerDraftSegment =
  | { kind: 'text'; text: string; start: number; end: number }
  | { kind: 'file'; relativePath: string; start: number; end: number }
  | { kind: 'pr'; number: number; start: number; end: number }
  | { kind: 'skill'; command: string; name: string; start: number; end: number }

type RawComposerMatch = {
  start: number
  end: number
  segment: Exclude<ComposerDraftSegment, { kind: 'text' }>
}

/** @path mention inserted by the composer @ menu (no spaces in path). */
const COMPOSER_AT_MENTION = /(?:^|[\s([{])@([^\s@]+)/g

/** Slash skill/command token at a word boundary. */
const COMPOSER_SKILL_SLASH = /(?:^|[\s([{`'"])\/([a-z][a-z0-9_-]{0,63})(?=\s|$|[.,;:!?)}\]`'"])/g

/** Completed `#123` PR mention at a word boundary (same boundaries as hash autocomplete). */
const COMPOSER_PR_HASH = /(?:^|[\s([{])#(\d+)(?=\s|$|[.,;:!?)}\]`'"])/g

function collectComposerMatches(text: string): RawComposerMatch[] {
  const out: RawComposerMatch[] = []

  COMPOSER_AT_MENTION.lastIndex = 0
  let atMatch: RegExpExecArray | null
  while ((atMatch = COMPOSER_AT_MENTION.exec(text)) !== null) {
    const relativePath = atMatch[1]
    if (!relativePath) continue
    const atStart = atMatch.index + atMatch[0].indexOf('@')
    const atEnd = atStart + 1 + relativePath.length
    out.push({
      start: atStart,
      end: atEnd,
      segment: { kind: 'file', relativePath, start: atStart, end: atEnd },
    })
  }

  COMPOSER_SKILL_SLASH.lastIndex = 0
  let slashMatch: RegExpExecArray | null
  while ((slashMatch = COMPOSER_SKILL_SLASH.exec(text)) !== null) {
    const name = slashMatch[1]
    if (!name || isConductorHostSlashName(name)) continue
    const slashStart = slashMatch.index + slashMatch[0].indexOf('/')
    const command = `/${name}`
    out.push({
      start: slashStart,
      end: slashStart + command.length,
      segment: { kind: 'skill', command, name, start: slashStart, end: slashStart + command.length },
    })
  }

  COMPOSER_PR_HASH.lastIndex = 0
  let prMatch: RegExpExecArray | null
  while ((prMatch = COMPOSER_PR_HASH.exec(text)) !== null) {
    const digits = prMatch[1]
    if (!digits) continue
    const number = Number(digits)
    if (!Number.isFinite(number)) continue
    const hashStart = prMatch.index + prMatch[0].indexOf('#')
    const hashEnd = hashStart + 1 + digits.length
    out.push({
      start: hashStart,
      end: hashEnd,
      segment: { kind: 'pr', number, start: hashStart, end: hashEnd },
    })
  }

  return out
}

function resolveComposerOverlaps(matches: RawComposerMatch[]): RawComposerMatch[] {
  const priority = (kind: ComposerDraftSegment['kind']) => {
    if (kind === 'file') return 3
    if (kind === 'pr') return 2
    if (kind === 'skill') return 1
    return 0
  }

  const sorted = [...matches].sort((a, b) => {
    const lengthDelta = b.end - b.start - (a.end - a.start)
    if (lengthDelta !== 0) return lengthDelta
    if (a.start !== b.start) return a.start - b.start
    return priority(b.segment.kind) - priority(a.segment.kind)
  })

  const taken: RawComposerMatch[] = []
  for (const match of sorted) {
    if (taken.some((existing) => !(match.end <= existing.start || match.start >= existing.end))) {
      continue
    }
    taken.push(match)
  }
  taken.sort((a, b) => a.start - b.start)
  return taken
}

/** Split composer draft text into inline text + @file + #pr + /skill segments. */
export function segmentComposerDraft(text: string): ComposerDraftSegment[] {
  if (!text) return []

  const matches = resolveComposerOverlaps(collectComposerMatches(text))
  if (matches.length === 0) {
    return [{ kind: 'text', text, start: 0, end: text.length }]
  }

  const segments: ComposerDraftSegment[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) {
      segments.push({
        kind: 'text',
        text: text.slice(cursor, match.start),
        start: cursor,
        end: match.start,
      })
    }
    segments.push(match.segment)
    cursor = match.end
  }
  if (cursor < text.length) {
    segments.push({
      kind: 'text',
      text: text.slice(cursor),
      start: cursor,
      end: text.length,
    })
  }
  return segments
}

export function composerDraftHasInlineChips(text: string): boolean {
  return segmentComposerDraft(text).some((segment) => segment.kind !== 'text')
}

/** Remove a trailing space after an inline token when backspacing/deleting atomically. */
function expandTokenRange(text: string, start: number, end: number): { start: number; end: number } {
  let expandedEnd = end
  if (text[expandedEnd] === ' ') expandedEnd += 1
  return { start, end: expandedEnd }
}

/** When the caret is collapsed, return the inline token to delete with Backspace. */
export function findComposerDraftTokenBeforeCursor(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): { start: number; end: number } | null {
  if (selectionStart !== selectionEnd) return null

  for (const segment of segmentComposerDraft(text)) {
    if (segment.kind === 'text') continue

    const trailingSpace = text[segment.end] === ' ' ? 1 : 0
    const deleteEnd = segment.end + trailingSpace
    const caretAfterToken = selectionStart >= segment.end && selectionStart <= deleteEnd
    const caretInsideToken = selectionStart > segment.start && selectionStart <= segment.end

    if (caretAfterToken || caretInsideToken) {
      return expandTokenRange(text, segment.start, segment.end)
    }
  }

  return null
}

/** When the caret is collapsed, return the inline token to delete with Delete. */
export function findComposerDraftTokenAfterCursor(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): { start: number; end: number } | null {
  if (selectionStart !== selectionEnd) return null

  for (const segment of segmentComposerDraft(text)) {
    if (segment.kind === 'text') continue
    if (selectionStart > segment.start) continue
    if (selectionStart === segment.start) {
      return expandTokenRange(text, segment.start, segment.end)
    }
  }

  return null
}

/** Range to remove for chip X buttons (includes adjacent padding space when sensible). */
export function composerDraftRemovalRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  return expandTokenRange(text, start, end)
}

export function removeComposerDraftRange(text: string, start: number, end: number): string {
  return text.slice(0, start) + text.slice(end)
}
