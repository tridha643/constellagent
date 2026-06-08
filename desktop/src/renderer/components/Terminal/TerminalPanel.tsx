import { useEffect, useRef, type DragEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useAppStore } from '../../store/app-store'
import { getAppearanceTerminalTheme } from '../../theme/appearance'
import { CONSTELLAGENT_PATH_MIME, wrapBracketedPaste } from '../../utils/add-to-chat'
import { logTerminalTiming, terminalTimingMs } from '../../utils/terminal-timing'
import styles from './TerminalPanel.module.css'

const TAB_TITLE_LOG = '[constellagent:tab-title]'

const PR_POLL_HINT_EVENT = 'constellagent:pr-poll-hint'
const PR_POLL_HINT_COMMAND_RE =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S+)\s+)*(?:sudo\s+)?(?:(?:git\s+push)|(?:gh\s+pr\s+(?:create|ready|reopen|merge))|(?:gt\s+(?:submit|ss)))(?:\s|$)/

interface Props {
  ptyId: string
  active: boolean
  /** When rendered inside a split container, uses relative positioning */
  inSplit?: boolean
  /** Pane ID for focus tracking inside splits */
  paneId?: string
  /** Called when this pane receives focus (for split focus tracking) */
  onFocus?: (paneId: string) => void
  /** Whether this pane is the focused pane within a split */
  isFocusedPane?: boolean
  /**
   * Stable key (tab id) used to persist this terminal's scrollback to disk so it
   * survives app quit. Only set for standalone terminals — split panes are
   * collapsed on restart, so their scrollback is intentionally ephemeral.
   */
  scrollbackKey?: string
}

/** Cap on the in-memory scrollback ring per terminal (matches main-side cap). */
const SCROLLBACK_RING_MAX_BYTES = 2 * 1024 * 1024
const TERMINAL_ATTACH_MAX_ATTEMPTS = 4
const TERMINAL_ATTACH_RETRY_BASE_MS = 150

export function TerminalPanel({ ptyId, active, inSplit, paneId, onFocus, isFocusedPane, scrollbackKey }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termDivRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitFnRef = useRef<(() => void) | null>(null)
  const inputLineRef = useRef('')
  /** Append-only ring of PTY output bytes — flushed to disk on quit. */
  const scrollbackRingRef = useRef('')
  const terminalFontSize = useAppStore((s) => s.settings.terminalFontSize)
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)

  const appendToScrollbackRing = (chunk: string) => {
    const next = scrollbackRingRef.current + chunk
    scrollbackRingRef.current =
      next.length > SCROLLBACK_RING_MAX_BYTES
        ? next.slice(next.length - SCROLLBACK_RING_MAX_BYTES)
        : next
  }

  const emitPrPollHint = (command: string) => {
    const normalized = command.trim().toLowerCase()
    const kind = normalized.startsWith('git push') ? 'push' : 'pr'
    window.dispatchEvent(
      new CustomEvent(PR_POLL_HINT_EVENT, {
        detail: { ptyId, command, kind },
      })
    )
  }

  const detectPrPollHint = (chunk: string): string | undefined => {
    // Remove cursor-control escape sequences so arrow keys do not pollute the command buffer.
    const cleaned = chunk
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\x1bO./g, '')
      .replace(/\x1b./g, '')

    let codexTabLine: string | undefined

    for (const char of cleaned) {
      if (char === '\r' || char === '\n') {
        const command = inputLineRef.current.trim()
        // Codex TUI: PTY write is often newline-only — bundle the local line on PTY_WRITE so main can derive the tab title with the same IPC as write().
        if (command.length >= 3 && !/^(y|n|p|yes|no)$/i.test(command)) {
          codexTabLine = command
        }
        if (command && PR_POLL_HINT_COMMAND_RE.test(command)) {
          emitPrPollHint(command)
        }
        inputLineRef.current = ''
        continue
      }

      if (char === '\u0003' || char === '\u0015') {
        inputLineRef.current = ''
        continue
      }

      if (char === '\u007f' || char === '\b') {
        inputLineRef.current = inputLineRef.current.slice(0, -1)
        continue
      }

      if (char < ' ' || char > '~') continue
      inputLineRef.current += char
      if (inputLineRef.current.length > 512) {
        inputLineRef.current = inputLineRef.current.slice(-512)
      }
    }

    return codexTabLine
  }

  useEffect(() => {
    if (!termDivRef.current) return

    const termDiv = termDivRef.current
    inputLineRef.current = ''

    let disposed = false
    let cleanup: (() => void) | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const attachStart = performance.now()
    let loggedFirstData = false

    const scheduleRetry = (attempt: number, reason: string, err?: unknown) => {
      if (disposed || attempt >= TERMINAL_ATTACH_MAX_ATTEMPTS) {
        console.error('Failed to initialize terminal:', { ptyId, reason, err })
        return
      }
      cleanup?.()
      cleanup = null
      termRef.current = null
      fitFnRef.current = null
      termDiv.innerHTML = ''
      const delay = TERMINAL_ATTACH_RETRY_BASE_MS * 2 ** attempt
      console.warn('Retrying terminal attach:', { ptyId, attempt: attempt + 1, reason, delay, err })
      retryTimer = setTimeout(() => setup(attempt + 1), delay)
    }

    const setup = (attempt = 0) => {
      try {
        if (retryTimer) {
          clearTimeout(retryTimer)
          retryTimer = null
        }
        termDiv.innerHTML = ''

        const term = new Terminal({
          fontSize: useAppStore.getState().settings.terminalFontSize,
          fontFamily: "'SF Mono', Menlo, 'Cascadia Code', monospace",
          cursorBlink: true,
          cursorStyle: 'bar',
          scrollback: 10000,
          theme: getAppearanceTerminalTheme(useAppStore.getState().settings.appearanceThemeId),
        })

        const fitAddon = new FitAddon()
        const webLinksAddon = new WebLinksAddon((event, uri) => {
          event.preventDefault()
          window.open(uri, '_blank')
        })
        term.loadAddon(fitAddon)
        term.loadAddon(webLinksAddon)
        term.open(termDiv)
        void window.api.pty.reattach(ptyId).catch((err) => {
          console.warn('PTY reattach probe failed during terminal setup:', { ptyId, err })
        })

        // ⌘1–9: xterm can see the keydown before/without the same capture path as `useShortcuts`
        // in some Electron focus cases — handle here so project switching always works from PTY focus.
        term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
          if (ev.type !== 'keydown') return true
          const cmd = ev.metaKey || ev.ctrlKey
          if (!cmd || ev.shiftKey || ev.altKey) return true
          let n: number | undefined
          const fromCode = /^Digit([1-9])$/.exec(ev.code) ?? /^Numpad([1-9])$/.exec(ev.code)
          if (fromCode) n = Number(fromCode[1])
          else if (ev.key >= '1' && ev.key <= '9') n = Number(ev.key)
          if (n === undefined) return true
          ev.preventDefault()
          ev.stopPropagation()
          useAppStore.getState().switchToProjectByIndex(n - 1)
          return false
        })

        if (disposed) {
          term.dispose()
          return
        }

        const fitTerminal = () => {
          if (disposed) return
          if (termDiv.clientWidth <= 0 || termDiv.clientHeight <= 0) return
          try {
            fitAddon.fit()
          } catch (err) {
            scheduleRetry(attempt, 'fit-failed', err)
          }
        }
        fitFnRef.current = fitTerminal

        // Defer fit until container has real dimensions. The previous 30-frame
        // budget (~500 ms) sometimes ran out before the contentArea finished
        // laying out — the terminal then rendered blank with no recovery
        // because xterm had been opened against a 0×0 div. Keep retrying
        // until the div has dimensions or the component is disposed; on the
        // first non-zero size, also force a refresh so xterm re-paints from
        // its (now-correct) buffer geometry.
        let didFirstFit = false
        let zeroSizeStartedAt = performance.now()
        const tryFit = () => {
          if (disposed) return
          if (termDiv.clientWidth > 0 && termDiv.clientHeight > 0) {
            fitTerminal()
            if (!didFirstFit) {
              didFirstFit = true
              try {
                term.refresh(0, term.rows - 1)
              } catch {
                /* refresh is best-effort — xterm versions vary */
              }
              logTerminalTiming('first-fit', {
                ptyId,
                cols: term.cols,
                rows: term.rows,
                attachToFitMs: terminalTimingMs(attachStart),
              })
            }
            return
          }
          if (active && performance.now() - zeroSizeStartedAt > 1200) {
            zeroSizeStartedAt = performance.now()
            void window.api.pty.reattach(ptyId).catch(() => {})
            scheduleRetry(attempt, 'active-terminal-still-zero-sized')
            return
          }
          requestAnimationFrame(tryFit)
        }
        requestAnimationFrame(tryFit)

        let resizeTimer: ReturnType<typeof setTimeout> | null = null
        const resizeObserver = new ResizeObserver(() => {
          if (resizeTimer) clearTimeout(resizeTimer)
          resizeTimer = setTimeout(() => {
            if (!disposed) fitTerminal()
          }, 100)
        })
        resizeObserver.observe(termDiv)

        const settleTimer = setTimeout(() => {
          if (!disposed) fitTerminal()
        }, 200)

        const onDataDisposable = term.onData((data: string) => {
          const codexTabLine = detectPrPollHint(data)
          const newlineOnlyChunk = /^[\r\n]+$/.test(data)
          if (newlineOnlyChunk) {
            if (codexTabLine !== undefined) {
              console.log(TAB_TITLE_LOG, 'renderer: newline-only PTY write, bundling local line for main codex title path', {
                ptyId,
                preview: codexTabLine.slice(0, 72),
              })
            } else {
              console.log(TAB_TITLE_LOG, 'renderer: newline-only PTY write, no bundled line (short/empty/y-n prompt buffer)', {
                ptyId,
              })
            }
          }
          window.api.pty.write(
            ptyId,
            data,
            codexTabLine !== undefined ? { submittedLine: codexTabLine } : undefined,
          )
        })

        const onResizeDisposable = term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
          window.api.pty.resize(ptyId, cols, rows)
        })

        const unsubData = window.api.pty.onData(ptyId, (data: string) => {
          if (disposed) return
          if (!loggedFirstData) {
            loggedFirstData = true
            logTerminalTiming('renderer-first-data', {
              ptyId,
              attachToFirstDataMs: terminalTimingMs(attachStart),
            })
          }
          term.write(data)
          // Track 6: keep an in-memory ring of PTY output so the scrollback
          // can be re-written into a fresh xterm on the next session.
          if (scrollbackKey) appendToScrollbackRing(data)
        })

        // Prefer the live main-process ring when remounting after a tab switch.
        // Fall back to disk scrollback only for fresh app starts where the PTY
        // ring is empty; otherwise remounting an inactive tab would duplicate
        // its history every time it becomes active again.
        void window.api.pty.snapshot(ptyId).then(async (snapshot) => {
          if (disposed) return
          if (snapshot) {
            term.write(snapshot)
            scrollbackRingRef.current = snapshot
            return
          }
          if (!scrollbackKey) return
          const saved = await window.api.pty.loadScrollback(scrollbackKey)
          if (disposed || !saved) return
          term.write(saved)
          scrollbackRingRef.current = saved
        }).catch(() => {})

        termRef.current = term

        cleanup = () => {
          resizeObserver.disconnect()
          if (resizeTimer) clearTimeout(resizeTimer)
          clearTimeout(settleTimer)
          onDataDisposable.dispose()
          onResizeDisposable.dispose()
          unsubData()
          term.dispose()
        }

        setTimeout(() => {
          if (!disposed && active) term.focus()
        }, 50)
      } catch (err) {
        scheduleRetry(attempt, 'setup-threw', err)
      }
    }

    setup()

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      cleanup?.()
      cleanup = null
      termRef.current = null
      fitFnRef.current = null
      inputLineRef.current = ''
    }
  }, [ptyId])

  // Track 6: persist scrollback to disk on quit and on tab close. Capture
  // phase keeps us ahead of app-store's bubble-phase saveSync handler so the
  // save IPC actually fires before the renderer is torn down.
  useEffect(() => {
    if (!scrollbackKey) return
    const flush = () => {
      const text = scrollbackRingRef.current
      if (!text) return
      void window.api.pty.saveScrollback(scrollbackKey, text).catch(() => {})
    }
    window.addEventListener('beforeunload', flush, true)
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      // Flush one last time on unmount: covers tab-close and workspace-switch
      // cases that don't trigger beforeunload.
      flush()
      window.removeEventListener('beforeunload', flush, true)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [scrollbackKey])

  // Update font size on live terminals.
  useEffect(() => {
    const term = termRef.current
    if (!term) return

    term.options.fontSize = terminalFontSize
    fitFnRef.current?.()
  }, [terminalFontSize])

  useEffect(() => {
    const term = termRef.current
    if (!term) return

    term.options.theme = getAppearanceTerminalTheme(appearanceThemeId)
  }, [appearanceThemeId])

  // Focus + refit when this tab becomes active.
  useEffect(() => {
    if (!active || !termRef.current) return

    fitFnRef.current?.()
    termRef.current.focus()
  }, [active])

  // Focus terminal when this pane becomes the focused pane in a split (e.g. Ctrl+Tab)
  useEffect(() => {
    if (inSplit && isFocusedPane && termRef.current) {
      termRef.current.focus()
    }
  }, [inSplit, isFocusedPane])

  const handleMouseDown = () => {
    if (paneId && onFocus) onFocus(paneId)
  }

  const handleDragOver = (e: DragEvent) => {
    if (
      e.dataTransfer.types.includes(CONSTELLAGENT_PATH_MIME)
      || e.dataTransfer.types.includes('text/plain')
    ) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const handleDrop = (e: DragEvent) => {
    const path =
      e.dataTransfer.getData(CONSTELLAGENT_PATH_MIME)
      || e.dataTransfer.getData('text/plain')
    if (!path?.trim()) return
    e.preventDefault()
    window.api.pty.write(ptyId, wrapBracketedPaste(path.trim()))
  }

  // In split mode: relative positioning, no visibility toggling (parent handles that)
  // In standalone mode: absolute-fill with visibility toggling
  const containerClass = inSplit
    ? `${styles.splitPane} ${isFocusedPane ? styles.focusedPane : ''}`
    : `${styles.terminalContainer} ${active ? styles.active : styles.hidden}`

  return (
    <div
      className={containerClass}
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Separate div for xterm — not managed by React. */}
      <div ref={termDivRef} className={styles.terminalInner} />
    </div>
  )
}
