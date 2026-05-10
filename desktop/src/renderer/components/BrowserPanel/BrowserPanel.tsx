import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const IS_MAC_LIKE =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
import { useAppStore } from '../../store/app-store'
import type { BrowserDomContext, ChatSnippet } from '../../store/types'
import { SPIDEY_CLIENT_SOURCE } from './spidey-client'
import type { BrowserCapturedItem, BrowserPickEvent } from './types'
import styles from './BrowserPanel.module.css'

type WorkspaceState = {
  url: string
  pendingUrl: string
  picking: boolean
  items: BrowserCapturedItem[]
}

const workspaceCache = new Map<string, WorkspaceState>()

function defaultState(): WorkspaceState {
  return { url: '', pendingUrl: 'http://localhost:5173', picking: false, items: [] }
}

function snippetForItem(item: BrowserCapturedItem): ChatSnippet {
  const note = item.userNote?.trim()
  const ctx: BrowserDomContext = {
    tagName: item.tagName,
    classes: item.classes,
    textPreview: item.textPreview,
    displayName: item.displayName,
    source: item.source,
    url: item.url,
    ...(note ? { userNote: note } : {}),
  }
  return { text: item.textPreview, browser: ctx }
}

export function BrowserPanel({ workspaceId }: { workspaceId: string }) {
  const initial = workspaceCache.get(workspaceId) ?? defaultState()
  const [url, setUrl] = useState(initial.url)
  const [pendingUrl, setPendingUrl] = useState(initial.pendingUrl)
  const [picking, setPicking] = useState(initial.picking)
  const [items, setItems] = useState<BrowserCapturedItem[]>(initial.items)

  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const sendContextToAgent = useAppStore((s) => s.sendContextToAgent)
  const addToast = useAppStore((s) => s.addToast)

  // Persist to in-memory cache so panel re-mounts (workspace switch / panel hide) restore.
  useEffect(() => {
    workspaceCache.set(workspaceId, { url, pendingUrl, picking, items })
  }, [workspaceId, url, pendingUrl, picking, items])

  const handleConsoleMessage = useCallback((event: Electron.ConsoleMessageEvent) => {
    const msg = event.message ?? ''
    const idx = msg.indexOf('__SPIDEY__:')
    if (idx === -1) return
    try {
      const json = msg.slice(idx + '__SPIDEY__:'.length)
      const parsed = JSON.parse(json) as BrowserPickEvent
      if (parsed.__spideySense === 'pick' && parsed.payload) {
        const item: BrowserCapturedItem = {
          ...parsed.payload,
          id: crypto.randomUUID(),
          capturedAt: Date.now(),
        }
        setItems((prev) => [...prev, item])
        return
      }
      if (parsed.__spideySense === 'cancel') {
        setPicking(false)
      }
    } catch {
      // ignore malformed sentinel payloads
    }
  }, [])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    wv.addEventListener('console-message', handleConsoleMessage)
    return () => {
      wv.removeEventListener('console-message', handleConsoleMessage)
    }
  }, [url, handleConsoleMessage])

  const startPick = useCallback(() => {
    const wv = webviewRef.current
    if (!wv || !url) {
      addToast({ id: crypto.randomUUID(), message: 'Load a URL first', type: 'warning' })
      return
    }
    setPicking(true)
    wv.executeJavaScript(SPIDEY_CLIENT_SOURCE).catch(() => {
      setPicking(false)
      addToast({ id: crypto.randomUUID(), message: 'Failed to start picker', type: 'error' })
    })
  }, [url, addToast])

  const stopPick = useCallback(() => {
    const wv = webviewRef.current
    setPicking(false)
    wv?.executeJavaScript('window.__spideySenseStop && window.__spideySenseStop();').catch(() => {})
  }, [])

  const submitUrl = useCallback(() => {
    const next = pendingUrl.trim()
    if (!next) return
    const normalized = /^[a-z]+:\/\//i.test(next) ? next : `http://${next}`
    setUrl(normalized)
    setPendingUrl(normalized)
  }, [pendingUrl])

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }, [])

  const clearItems = useCallback(() => setItems([]), [])

  const setItemNote = useCallback((id: string, userNote: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, userNote } : it)))
  }, [])

  const sendAll = useCallback(() => {
    if (items.length === 0) return
    sendContextToAgent(items.map(snippetForItem))
    setItems([])
  }, [items, sendContextToAgent])

  const status = useMemo(() => {
    if (!url) {
      return { lead: 'Load a URL to open the embedded browser.', picking: false as const }
    }
    if (picking) {
      return {
        lead: 'Click elements to capture; highlight clears after each pick.',
        picking: true as const,
      }
    }
    return {
      lead: items.length === 0 ? 'No elements captured yet.' : `${items.length} in queue`,
      picking: false as const,
    }
  }, [url, picking, items.length])

  return (
    <div className={styles.wrap}>
      <div className={styles.urlBar}>
        <input
          className={styles.urlInput}
          value={pendingUrl}
          onChange={(e) => setPendingUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitUrl() }}
          placeholder="https://localhost:5173"
          spellCheck={false}
          aria-label="Page URL"
        />
        <button type="button" className={styles.btn} onClick={submitUrl}>
          Go
        </button>
      </div>

      <div className={styles.toolbar}>
        <button
          type="button"
          className={`${styles.btn} ${picking ? styles.btnActive : ''}`}
          onClick={picking ? stopPick : startPick}
          disabled={!url}
          title={picking ? 'Stop picking (Esc in page)' : 'Pick a DOM element'}
        >
          {picking ? 'Stop picking' : 'Pick element'}
        </button>
        <span className={styles.meta}>
          {status.picking && <span className={styles.pickingPulse} aria-hidden />}
          <span className={styles.metaStrong}>{status.lead}</span>
          {status.picking && (
            <>
              <kbd className={styles.kbd}>Esc</kbd>
              <span className={styles.noteHint}>in page</span>
            </>
          )}
        </span>
      </div>

      <div className={styles.frameWrap}>
        {url ? (
          <webview
            key={url}
            ref={webviewRef as React.Ref<HTMLElement>}
            className={styles.webview}
            src={url}
            allowpopups
          />
        ) : (
          <div className={styles.empty}>
            Enter a URL above (for example your local dev server), then press Go to load it here.
          </div>
        )}
      </div>

      {items.length > 0 && (
        <>
          <div className={styles.listHeader}>
            <span className={styles.listTitle}>Captured</span>
            <span className={styles.listCount}>{items.length}</span>
          </div>
          <div className={styles.list}>
            {items.map((it) => (
              <div key={it.id} className={styles.item}>
                <div className={styles.itemHead}>
                  {it.displayName && <span className={styles.name}>{`<${it.displayName}>`}</span>}
                  <code>{it.tagName.toLowerCase()}{it.classes.length ? '.' + it.classes.slice(0, 2).join('.') : ''}</code>
                  <button
                    type="button"
                    className={styles.remove}
                    onClick={() => removeItem(it.id)}
                    aria-label={`Remove ${it.tagName.toLowerCase()} capture`}
                  >
                    ×
                  </button>
                </div>
                {it.textPreview && <div className={styles.itemSub}>“{it.textPreview}”</div>}
                {it.source && (
                  <div className={styles.itemSub}>
                    {it.source.file}:{it.source.line}
                  </div>
                )}
                <div className={styles.noteBlock}>
                  <label className={styles.noteLabel}>
                    <span className={styles.noteLabelText}>
                      Context note
                      <span className={styles.noteHint}>
                        <kbd className={styles.kbd}>{IS_MAC_LIKE ? '⌘' : 'Ctrl'}</kbd>
                        {' + '}
                        <kbd className={styles.kbd}>↵</kbd>
                        {' done'}
                      </span>
                    </span>
                    <input
                      type="text"
                      className={styles.noteInput}
                      value={it.userNote ?? ''}
                      onChange={(e) => setItemNote(it.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          ;(e.target as HTMLInputElement).blur()
                        }
                      }}
                      placeholder="Optional hint for the agent…"
                      spellCheck
                      aria-label={`Context note for ${it.tagName.toLowerCase()}`}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className={styles.sendRow}>
        <button
          type="button"
          className={`${styles.btn} ${styles.primary}`}
          onClick={sendAll}
          disabled={items.length === 0}
        >
          Send {items.length || ''} to agent
        </button>
        {items.length > 0 && (
          <button type="button" className={styles.btn} onClick={clearItems}>Clear</button>
        )}
      </div>
    </div>
  )
}
