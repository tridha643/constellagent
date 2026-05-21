import { type Extension, StateField } from "@codemirror/state";

/**
 * READ-ONLY stub of the editor's drag-selection gate.
 *
 * In the full writer app, `drag-selection-gate.ts` snapshots the live
 * selection on `pointerdown` so selection-aware decorations (table / html-block
 * fold widgets, the prosemark hide/fold fields) don't reflow text out from
 * under a mouse drag. None of that applies to a read-only streaming-message
 * renderer: there is no editing, no caret, and no drag-selection to freeze.
 *
 * This stub exists only so the cherry-picked decoration modules
 * (`table-decorations.ts`, `html-block-decorations.ts`) type-check and behave
 * correctly in the read-only build:
 *
 *  - `dragFrozenSelectionField` always holds an empty array. The decoration
 *    modules read it via `state.field(dragFrozenSelectionField, false)` and,
 *    when truthy, call `rangesTouchInclusive(frozen, node)`. An empty array is
 *    truthy, and `rangesTouchInclusive` always returns `false`, so the
 *    "frozen drag" branch resolves to "nothing is touched" — i.e. decorations
 *    always render. That is exactly the desired read-only behavior.
 *  - No transaction ever mutates the field (no effects, no drag plugin), so the
 *    value stays `[]` for the lifetime of the view.
 */

export interface FrozenRange {
  from: number;
  to: number;
}

const EMPTY_FROZEN_RANGES: readonly FrozenRange[] = [];

export const dragFrozenSelectionField: StateField<readonly FrozenRange[]> =
  StateField.define<readonly FrozenRange[]>({
    create() {
      return EMPTY_FROZEN_RANGES;
    },
    update(value) {
      // Read-only: nothing ever changes the snapshot.
      return value;
    },
  });

/**
 * Read-only: a message can never be drag-selected, so no node range is ever
 * "touched" by a frozen drag selection. Always returns false.
 */
export function rangesTouchInclusive(
  _ranges: readonly FrozenRange[],
  _node: { from: number; to: number },
): boolean {
  return false;
}

/**
 * Read-only no-op bundle, mirroring the real module's `dragFreezeExtensions`
 * export shape. Mounting it just registers the always-empty field.
 */
export const dragFreezeExtensions: Extension = [dragFrozenSelectionField];
