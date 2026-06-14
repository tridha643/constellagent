import { describe, expect, it } from 'bun:test'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'

/**
 * Validates the premise of the terminal-state-persistence fix: the main-process
 * headless mirror, serialized via SerializeAddon, reconstructs the *live screen*
 * — including the alternate-screen buffer used by TUIs like pi/codex — when
 * replayed into a fresh terminal. This is what the old raw-byte ring could not
 * do once it truncated and severed the `?1049h` alt-screen enter sequence.
 */

const COLS = 80
const ROWS = 24

function write(term: HeadlessTerminal, data: string): Promise<void> {
  // headless write() is async — the VT parser runs on a later tick.
  return new Promise((resolve) => term.write(data, resolve))
}

function makeTerm(): HeadlessTerminal {
  return new HeadlessTerminal({ cols: COLS, rows: ROWS, scrollback: 5000, allowProposedApi: true })
}

function visibleText(term: HeadlessTerminal): string {
  const buf = term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < term.rows; i++) {
    lines.push(buf.getLine(buf.viewportY + i)?.translateToString(true) ?? '')
  }
  return lines.join('\n').replace(/\s+$/g, '')
}

describe('headless serialize snapshot (cmux-style cold-attach replay)', () => {
  it('reconstructs an alternate-screen TUI view into a fresh terminal', async () => {
    const source = makeTerm()
    const serialize = new SerializeAddon()
    source.loadAddon(serialize)

    // A TUI session: some normal-screen scrollback, then enter the alt screen
    // (what pi/codex do) and paint a full-screen UI.
    await write(source, 'normal-screen line before TUI\r\n')
    await write(source, '\x1b[?1049h') // enter alternate screen buffer
    await write(source, '\x1b[2J\x1b[H') // clear + home
    await write(source, 'PI TUI HEADER\r\n')
    await write(source, '> live prompt content')

    expect(source.buffer.active.type).toBe('alternate')

    const snapshot = serialize.serialize({ scrollback: 5000 })

    // Cold attach: a brand-new terminal (as if after ⌘R / workspace switch).
    const restored = makeTerm()
    await write(restored, snapshot)

    expect(restored.buffer.active.type).toBe('alternate')
    const text = visibleText(restored)
    expect(text).toContain('PI TUI HEADER')
    expect(text).toContain('> live prompt content')
  })

  it('reconstructs normal-screen scrollback and the prompt', async () => {
    const source = makeTerm()
    const serialize = new SerializeAddon()
    source.loadAddon(serialize)

    await write(source, 'first command output\r\n')
    await write(source, 'second command output\r\n')
    await write(source, 'user@host:~$ ')

    const snapshot = serialize.serialize({ scrollback: 5000 })

    const restored = makeTerm()
    await write(restored, snapshot)

    expect(restored.buffer.active.type).toBe('normal')
    const text = visibleText(restored)
    expect(text).toContain('first command output')
    expect(text).toContain('second command output')
    expect(text).toContain('user@host:~$')
  })
})
