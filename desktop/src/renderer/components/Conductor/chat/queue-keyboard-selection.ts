export function selectQueueMessageAbove(
  messageIds: readonly string[],
  selectedMessageId: string | null,
): string | null {
  if (messageIds.length === 0) return null
  if (!selectedMessageId) return messageIds[messageIds.length - 1] ?? null

  const selectedIndex = messageIds.indexOf(selectedMessageId)
  if (selectedIndex <= 0) return messageIds[0] ?? null
  return messageIds[selectedIndex - 1] ?? null
}

export function selectQueueMessageBelow(
  messageIds: readonly string[],
  selectedMessageId: string | null,
): string | null {
  if (!selectedMessageId) return null

  const selectedIndex = messageIds.indexOf(selectedMessageId)
  if (selectedIndex < 0 || selectedIndex >= messageIds.length - 1) return null
  return messageIds[selectedIndex + 1] ?? null
}

export function reconcileSelectedQueueMessageId(
  messageIds: readonly string[],
  selectedMessageId: string | null,
): string | null {
  if (!selectedMessageId) return null
  return messageIds.includes(selectedMessageId) ? selectedMessageId : null
}
