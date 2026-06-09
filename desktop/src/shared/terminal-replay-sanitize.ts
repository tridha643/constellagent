/**
 * Strip terminal *query* and *report* escape sequences from a buffer that is
 * about to be **replayed** into a fresh xterm instance (e.g. restoring a tmux
 * session's scrollback on reattach).
 *
 * Why this exists: a PTY scrollback buffer captures the raw output of programs
 * like `tmux`, which probe the outer terminal's capabilities by emitting
 * Device-Attributes / status queries (e.g. `ESC [ c`, `ESC [ > c`). When that
 * history is written back into a new xterm, xterm dutifully *answers* the old
 * queries and forwards the answers (`ESC [ ? 1 ; 2 c`, `ESC [ > 0 ; 276 ; 0 c`)
 * to the live PTY — where the shell, sitting at its prompt, echoes them as the
 * stray `1;2c0;276;0c…` text. Removing the queries from the replayed bytes
 * stops xterm from generating those phantom responses.
 *
 * Only apply this to **historical replay** bytes. Live PTY output must pass
 * through untouched so xterm can answer real-time queries from running programs
 * (which consume the responses correctly).
 *
 * The targeted finals (`c`, `n`, `R`, DECRQM `$p/$y`, DCS, OSC `?` queries) are
 * exclusive to queries/reports — none of them carry visible content or affect
 * rendering state (cursor moves, SGR, alt-screen, etc. are left intact).
 */
export function sanitizeTerminalReplay(input: string): string {
  if (!input) return input
  return (
    input
      // Device Attributes — DA1/DA2/DA3 queries *and* responses (CSI [?>=] … c).
      .replace(/\x1b\[[?>=][0-9;]*c/g, '')
      .replace(/\x1b\[[0-9;]*c/g, '')
      // Device Status Report — queries (5n/6n) and responses (0n) (CSI [?] … n).
      .replace(/\x1b\[[?]?[0-9;]*n/g, '')
      // Cursor Position Report response (CSI row ; col R).
      .replace(/\x1b\[[0-9]+;[0-9]+R/g, '')
      // DECRQM mode query/report (CSI [?] … $ p|y).
      .replace(/\x1b\[[?]?[0-9;]*\$[py]/g, '')
      // DCS strings: DECRQSS / XTGETTCAP capability queries (ESC P … ESC \).
      .replace(/\x1bP[$+!][\s\S]*?\x1b\\/g, '')
      // OSC color / clipboard *queries* ending in `?` (ESC ] n ; … ? BEL|ST).
      .replace(/\x1b\][0-9]+;[^\x07\x1b]*\?(?:\x07|\x1b\\)/g, '')
  )
}
