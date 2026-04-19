/**
 * Pure reorder helper for drag-and-drop tab reordering.
 * Removes `draggedId` from `orderIds`, then inserts it before or after `overId`.
 */
export type DropSide = 'before' | 'after'

export function computeReorder(
  orderIds: readonly string[],
  draggedId: string,
  overId: string,
  side: DropSide,
): string[] {
  if (draggedId === overId) {
    return [...orderIds]
  }
  const without = orderIds.filter((id) => id !== draggedId)
  const overIdx = without.indexOf(overId)
  if (overIdx < 0) {
    return [...orderIds]
  }
  const insertAt = side === 'before' ? overIdx : overIdx + 1
  const next = [...without]
  next.splice(insertAt, 0, draggedId)
  return next
}
