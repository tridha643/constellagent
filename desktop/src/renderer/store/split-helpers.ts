import type { SplitNode } from './types'

/** Recursively collect all PTY IDs from a split tree. */
export function getAllPtyIds(node: SplitNode): string[] {
  if (node.type === 'leaf') return [node.ptyId]
  return node.children.flatMap(getAllPtyIds)
}

/** Find a leaf node by its pane ID. */
export function findLeaf(root: SplitNode, paneId: string): (SplitNode & { type: 'leaf' }) | null {
  if (root.type === 'leaf') return root.id === paneId ? root : null
  for (const child of root.children) {
    const found = findLeaf(child, paneId)
    if (found) return found
  }
  return null
}

/** Find a leaf node by its PTY ID. */
export function findLeafByPtyId(root: SplitNode, ptyId: string): (SplitNode & { type: 'leaf' }) | null {
  if (root.type === 'leaf') return root.ptyId === ptyId ? root : null
  for (const child of root.children) {
    const found = findLeafByPtyId(child, ptyId)
    if (found) return found
  }
  return null
}

/**
 * Replace a leaf with a split node containing the original leaf and a new leaf.
 * Returns a new tree (immutable).
 */
export function splitLeaf(
  root: SplitNode,
  leafId: string,
  direction: 'horizontal' | 'vertical',
  newLeafId: string,
  newPtyId: string,
): SplitNode {
  if (root.type === 'leaf') {
    if (root.id === leafId) {
      return {
        type: 'split',
        id: crypto.randomUUID(),
        direction,
        children: [
          root,
          { type: 'leaf', id: newLeafId, ptyId: newPtyId },
        ],
      }
    }
    return root
  }

  // Recurse into children
  const newChildren = root.children.map((child) =>
    splitLeaf(child, leafId, direction, newLeafId, newPtyId),
  ) as [SplitNode, SplitNode]

  // Only create a new node if something changed
  if (newChildren[0] === root.children[0] && newChildren[1] === root.children[1]) {
    return root
  }
  return { ...root, children: newChildren }
}

/**
 * Remove a leaf from the tree. If removing leaves only one child in a split,
 * collapse the split to that child. Returns null if the tree becomes empty.
 */
export function removeLeaf(root: SplitNode, leafId: string): SplitNode | null {
  if (root.type === 'leaf') {
    return root.id === leafId ? null : root
  }

  const newChildren = root.children.map((child) => removeLeaf(child, leafId))

  // If one child was removed, collapse to the surviving child
  if (newChildren[0] === null) return newChildren[1]
  if (newChildren[1] === null) return newChildren[0]

  // Only create a new node if something changed
  if (newChildren[0] === root.children[0] && newChildren[1] === root.children[1]) {
    return root
  }
  return { ...root, children: newChildren as [SplitNode, SplitNode] }
}

/** Get the first leaf in the tree (depth-first, left-to-right). */
export function firstLeaf(root: SplitNode): SplitNode & { type: 'leaf' } {
  if (root.type === 'leaf') return root
  return firstLeaf(root.children[0])
}

/** Get the focused pane's PTY ID, falling back to the tab's primary ptyId. */
export function getFocusedPtyId(
  splitRoot: SplitNode | undefined,
  focusedPaneId: string | undefined,
  fallbackPtyId: string,
): string {
  if (!splitRoot || !focusedPaneId) return fallbackPtyId
  const leaf = findLeaf(splitRoot, focusedPaneId)
  return leaf ? leaf.ptyId : fallbackPtyId
}
