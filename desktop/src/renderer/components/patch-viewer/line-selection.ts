import type { CodeViewLineSelection, SelectedLineRange } from '@pierre/diffs'
import type { DiffAnnotationSide } from '@shared/diff-annotation-types'
import { filePathFromItemId, getCodeViewItemId } from './patch-utils'

/**
 * Selection model: Pierre `SelectedLineRange` (per-item) ↔ our comment draft
 * target. CodeView selection is global (`{ id, range }`), so the draft must
 * carry which file (item id) it belongs to. Also feeds the agent-submit "Add to
 * Chat" attachment.
 */

export interface PatchDraftTarget {
  itemId: string
  filePath: string
  side: DiffAnnotationSide
  lineNumber: number
  lineEnd: number
}

/** Pierre drag range → annotation anchor (cross-side drags collapse to a line). */
export function normalizeSelectedRange(range: SelectedLineRange): {
  side: DiffAnnotationSide
  lineNumber: number
  lineEnd: number
} {
  const side = (range.side ?? 'additions') as DiffAnnotationSide
  if (range.endSide != null && range.endSide !== side) {
    return { side, lineNumber: range.start, lineEnd: range.start }
  }
  const lo = Math.min(range.start, range.end)
  const hi = Math.max(range.start, range.end)
  return { side, lineNumber: lo, lineEnd: hi }
}

export function selectionToDraft(selection: CodeViewLineSelection): PatchDraftTarget {
  const { side, lineNumber, lineEnd } = normalizeSelectedRange(selection.range)
  return {
    itemId: selection.id,
    filePath: filePathFromItemId(selection.id),
    side,
    lineNumber,
    lineEnd,
  }
}

export function draftToSelection(target: PatchDraftTarget): CodeViewLineSelection {
  const lo = Math.min(target.lineNumber, target.lineEnd)
  const hi = Math.max(target.lineNumber, target.lineEnd)
  return {
    id: target.itemId,
    range: { start: lo, end: hi, side: target.side, endSide: target.side },
  }
}

export function draftTargetFor(
  filePath: string,
  side: DiffAnnotationSide,
  lineNumber: number,
  lineEnd: number = lineNumber,
): PatchDraftTarget {
  return { itemId: getCodeViewItemId(filePath), filePath, side, lineNumber, lineEnd }
}

export function draftTargetsEqual(a: PatchDraftTarget | null, b: PatchDraftTarget | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.itemId === b.itemId &&
    a.side === b.side &&
    a.lineNumber === b.lineNumber &&
    a.lineEnd === b.lineEnd
  )
}
