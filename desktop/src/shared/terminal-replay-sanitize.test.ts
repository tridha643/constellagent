import { describe, expect, it } from 'bun:test'
import { sanitizeTerminalReplay } from './terminal-replay-sanitize'

const ESC = '\x1b'

describe('sanitizeTerminalReplay', () => {
  it('removes the DA1 / DA2 queries that cause phantom reattach responses', () => {
    // The exact shape seen in scrollback: tmux probes the outer terminal.
    const buf = `prompt $ ${ESC}[c${ESC}[>c more`
    expect(sanitizeTerminalReplay(buf)).toBe('prompt $  more')
  })

  it('removes DA responses too (harmless in history)', () => {
    // `1;2c` (DA1) and `>0;276;0c` (DA2) — the garbage from the bug report.
    const buf = `${ESC}[?1;2c${ESC}[>0;276;0c`
    expect(sanitizeTerminalReplay(buf)).toBe('')
  })

  it('strips DSR and cursor-position reports', () => {
    expect(sanitizeTerminalReplay(`${ESC}[6n${ESC}[5n`)).toBe('')
    expect(sanitizeTerminalReplay(`row${ESC}[12;40R`)).toBe('row')
  })

  it('strips DCS capability queries and OSC color queries', () => {
    expect(sanitizeTerminalReplay(`${ESC}P+q544e${ESC}\\x`)).toBe('x')
    expect(sanitizeTerminalReplay(`${ESC}]10;?${ESC}\\done`)).toBe('done')
    expect(sanitizeTerminalReplay(`${ESC}]11;?\x07ok`)).toBe('ok')
  })

  it('preserves visible text and rendering sequences (SGR, cursor moves, alt screen)', () => {
    const visible =
      `${ESC}[1;32mgreen${ESC}[0m text ${ESC}[10C${ESC}[?25h${ESC}[?1049h$ ls`
    expect(sanitizeTerminalReplay(visible)).toBe(visible)
  })

  it('does not confuse CUF (CSI n C) with a DA query (CSI n c)', () => {
    const buf = `${ESC}[5Ckeep` // cursor-forward 5 — must survive
    expect(sanitizeTerminalReplay(buf)).toBe(buf)
  })

  it('is a no-op on empty input', () => {
    expect(sanitizeTerminalReplay('')).toBe('')
  })
})
