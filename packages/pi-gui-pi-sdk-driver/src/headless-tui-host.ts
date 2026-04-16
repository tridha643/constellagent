import type { Terminal } from "@mariozechner/pi-tui";

/** Minimal terminal stub for `Editor` + headless `ctx.ui.custom()` (no real stdout/stdin). */
export function createHeadlessTerminal(initialColumns: number, initialRows: number): Terminal {
  const state = { columns: initialColumns, rows: initialRows };
  return {
    get columns() {
      return state.columns;
    },
    get rows() {
      return state.rows;
    },
    get kittyProtocolActive() {
      return false;
    },
    start() {},
    stop() {},
    drainInput: async () => {},
    write() {},
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
  } as Terminal;
}
