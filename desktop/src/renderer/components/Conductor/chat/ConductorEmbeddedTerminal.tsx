import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { X } from 'lucide-react'
import { useAppStore } from '../../../store/app-store'
import { getAppearanceTerminalTheme } from '../../../theme/appearance'
import styles from '../Conductor.module.css'

export function ConductorEmbeddedTerminal({
  ptyId,
  onDone,
}: {
  ptyId: string
  onDone: () => void
}) {
  const termDivRef = useRef<HTMLDivElement>(null)
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const terminalFontSize = useAppStore((s) => s.settings.terminalFontSize)

  useEffect(() => {
    const termDiv = termDivRef.current
    if (!termDiv) return

    let disposed = false
    const term = new Terminal({
      fontSize: terminalFontSize,
      fontFamily: "'SF Mono', Menlo, 'Cascadia Code', monospace",
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      theme: getAppearanceTerminalTheme(appearanceThemeId),
    })
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      event.preventDefault()
      void window.api.app.openExternal(uri)
    })
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(termDiv)
    void window.api.pty.reattach(ptyId).catch(() => {})

    const fit = () => {
      if (disposed || termDiv.clientWidth <= 0 || termDiv.clientHeight <= 0) return
      try {
        fitAddon.fit()
        window.api.pty.resize(ptyId, term.cols, term.rows)
      } catch {
        /* best-effort */
      }
    }

    requestAnimationFrame(fit)
    const resizeObserver = new ResizeObserver(() => fit())
    resizeObserver.observe(termDiv)

    const offData = window.api.pty.onData(ptyId, (chunk) => {
      term.write(chunk)
    })

    const onDataDisposable = term.onData((data) => {
      window.api.pty.write(ptyId, data)
    })

    term.focus()

    return () => {
      disposed = true
      onDataDisposable.dispose()
      offData()
      resizeObserver.disconnect()
      term.dispose()
    }
  }, [ptyId, appearanceThemeId, terminalFontSize])

  return (
    <div className={styles.conductorEmbeddedTerminal} data-testid="conductor-embedded-terminal">
      <div className={styles.conductorEmbeddedTerminalHeader}>
        <span>Complete /mcp below, then click done</span>
        <div className={styles.conductorEmbeddedTerminalHeaderActions}>
          <button type="button" className={styles.conductorEmbeddedTerminalDone} onClick={onDone}>
            Done
          </button>
          <button type="button" className={styles.conductorPanelClose} aria-label="Close" onClick={onDone}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className={styles.conductorEmbeddedTerminalStatus}>Running /mcp.</div>
      <div className={styles.conductorEmbeddedTerminalBody} ref={termDivRef} />
    </div>
  )
}
