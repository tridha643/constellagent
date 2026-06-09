import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, Globe, RotateCw, X } from 'lucide-react'
import { useAppStore } from '../../store/app-store'
import type { Tab } from '../../store/types'
import {
  AGENTATION_WEBVIEW_PARTITION,
  type AgentationAnnotation,
  type AgentationSession,
} from '../../../shared/agentation-types'
import { Tooltip } from '../Tooltip/Tooltip'
import { buildAgentationInjectScript } from './agentation-inject'
import { getBrowserGuestScriptUrl } from './browser-guest-url'
import { resolveAgentationEndpoint } from '../../hooks/useAgentationEvents'
import styles from './BrowserPanel.module.css'

const DEFAULT_PAGE_URL = 'http://localhost:5173'

type BrowserTab = Extract<Tab, { type: 'browser' }>

function kindLabel(kind: AgentationAnnotation['kind']): string {
  if (kind === 'placement') return 'Placement'
  if (kind === 'rearrange') return 'Rearrange'
  return 'Feedback'
}

function sessionTitle(session: AgentationSession): string {
  if (session.id === '__ungrouped__') return 'Annotations'
  return session.title?.trim() || session.url || session.id
}

function filterSessionsForTab(
  sessions: AgentationSession[],
  tab: BrowserTab,
): AgentationSession[] {
  const withAnnotations = sessions.filter((s) => s.annotations.length > 0)
  if (tab.sessionId) {
    return withAnnotations.filter((s) => s.id === tab.sessionId)
  }
  if (tab.url) {
    return withAnnotations.filter((s) => !s.url || s.url === tab.url)
  }
  return withAnnotations
}

export function BrowserPanel({ tab, active }: { tab: BrowserTab; active: boolean }) {
  const status = useAppStore((s) => s.agentationStatus)
  const sessions = useAppStore((s) => s.agentationSessions)
  const settingsEndpoint = useAppStore((s) => s.settings.agentationEndpoint)
  const refreshAgentation = useAppStore((s) => s.refreshAgentation)
  const sendAgentationAnnotation = useAppStore((s) => s.sendAgentationAnnotation)
  const resolveAgentationAnnotation = useAppStore((s) => s.resolveAgentationAnnotation)
  const dismissAgentationAnnotation = useAppStore((s) => s.dismissAgentationAnnotation)
  const setBrowserTabUrl = useAppStore((s) => s.setBrowserTabUrl)
  const setBrowserTabSessionId = useAppStore((s) => s.setBrowserTabSessionId)
  const addToast = useAppStore((s) => s.addToast)

  const loadedUrl = tab.url
  const [pendingUrl, setPendingUrl] = useState(loadedUrl || DEFAULT_PAGE_URL)
  const [retrying, setRetrying] = useState(false)
  const [busyById, setBusyById] = useState<Record<string, boolean>>({})
  const [preloadPath, setPreloadPath] = useState<string | null>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const webviewCleanupRef = useRef<(() => void) | null>(null)
  const guestScriptUrl = useMemo(() => getBrowserGuestScriptUrl(), [])

  const agentationEndpoint = resolveAgentationEndpoint(status?.endpoint, settingsEndpoint)

  useEffect(() => {
    void window.api.app.getBrowserWebviewPreloadPath().then(setPreloadPath)
  }, [])

  useEffect(() => {
    setPendingUrl(loadedUrl || DEFAULT_PAGE_URL)
  }, [tab.id, loadedUrl])

  const injectAgentation = useCallback(
    (opts?: { quiet?: boolean }) => {
      const wv = webviewRef.current
      if (!wv || !loadedUrl) {
        if (!opts?.quiet) {
          addToast({
            id: `browser-annotate-no-page-${Date.now()}`,
            message: 'Load a URL first',
            type: 'warning',
          })
        }
        return
      }
      const script = buildAgentationInjectScript(
        agentationEndpoint,
        guestScriptUrl,
        tab.sessionId,
      )
      wv.executeJavaScript(script).catch(() => {
        addToast({
          id: `browser-annotate-inject-${Date.now()}`,
          message: 'Could not inject the Agentation toolbar into this page',
          type: 'error',
        })
      })
    },
    [loadedUrl, agentationEndpoint, guestScriptUrl, tab.sessionId, addToast],
  )

  const bindWebview = useCallback(
    (node: Electron.WebviewTag | null) => {
      if (webviewCleanupRef.current) {
        webviewCleanupRef.current()
        webviewCleanupRef.current = null
      }
      webviewRef.current = node
      if (!node) return

      const syncNavState = () => {
        try {
          setCanGoBack(node.canGoBack())
          setCanGoForward(node.canGoForward())
        } catch {
          setCanGoBack(false)
          setCanGoForward(false)
        }
      }
      const onDomReady = () => {
        injectAgentation({ quiet: true })
        syncNavState()
      }
      const onDidNavigate = () => {
        injectAgentation({ quiet: true })
        syncNavState()
      }
      const onIpcMessage = (event: Electron.IpcMessageEvent) => {
        if (event.channel === 'agentation:copy') {
          const markdown = String(event.args[0] ?? '')
          void navigator.clipboard.writeText(markdown).then(
            () =>
              addToast({
                id: `browser-copy-${Date.now()}`,
                message: 'Copied annotations to clipboard',
                type: 'info',
              }),
            () =>
              addToast({
                id: `browser-copy-err-${Date.now()}`,
                message: 'Could not copy to clipboard',
                type: 'error',
              }),
          )
        } else if (event.channel === 'agentation:submit') {
          const output = String(event.args[0] ?? '')
          if (output.trim()) sendAgentationAnnotation(output)
        } else if (event.channel === 'agentation:session-created') {
          const sessionId = String(event.args[0] ?? '')
          if (sessionId) setBrowserTabSessionId(tab.id, sessionId)
        }
      }

      node.addEventListener('dom-ready', onDomReady)
      node.addEventListener('did-navigate', onDidNavigate)
      node.addEventListener('did-navigate-in-page', onDidNavigate)
      node.addEventListener('ipc-message', onIpcMessage)
      webviewCleanupRef.current = () => {
        node.removeEventListener('dom-ready', onDomReady)
        node.removeEventListener('did-navigate', onDidNavigate)
        node.removeEventListener('did-navigate-in-page', onDidNavigate)
        node.removeEventListener('ipc-message', onIpcMessage)
      }
    },
    [injectAgentation, addToast, sendAgentationAnnotation, setBrowserTabSessionId, tab.id],
  )

  useEffect(() => {
    return () => {
      if (webviewCleanupRef.current) webviewCleanupRef.current()
    }
  }, [])

  const submitUrl = useCallback(() => {
    const next = pendingUrl.trim()
    if (!next) return
    const normalized = /^[a-z]+:\/\//i.test(next) ? next : `http://${next}`
    setBrowserTabUrl(tab.id, normalized)
    setPendingUrl(normalized)
  }, [pendingUrl, setBrowserTabUrl, tab.id])

  const goBack = useCallback(() => {
    const wv = webviewRef.current
    if (wv?.canGoBack()) wv.goBack()
  }, [])

  const goForward = useCallback(() => {
    const wv = webviewRef.current
    if (wv?.canGoForward()) wv.goForward()
  }, [])

  const connected = status?.connected ?? false
  const reconnecting = status?.reconnecting ?? false
  const endpoint = status?.endpoint ?? agentationEndpoint

  const visibleSessions = useMemo(
    () => filterSessionsForTab(sessions, tab),
    [sessions, tab],
  )
  const totalAnnotations = useMemo(
    () => visibleSessions.reduce((n, s) => n + s.annotations.length, 0),
    [visibleSessions],
  )

  const handleRetry = useCallback(async () => {
    setRetrying(true)
    try {
      await refreshAgentation()
    } finally {
      setRetrying(false)
    }
  }, [refreshAgentation])

  const withBusy = useCallback(
    async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, verb: string) => {
      setBusyById((m) => ({ ...m, [id]: true }))
      try {
        const result = await fn()
        if (!result.ok) {
          addToast({
            id: `browser-${verb}-err-${Date.now()}`,
            message: `Could not ${verb}: ${result.error ?? 'unknown error'}`,
            type: 'error',
          })
        }
      } finally {
        setBusyById((m) => {
          const next = { ...m }
          delete next[id]
          return next
        })
      }
    },
    [addToast],
  )

  const statusTone = connected ? 'ok' : reconnecting ? 'warn' : 'down'
  const statusText = connected ? 'Connected' : reconnecting ? 'Reconnecting…' : 'Starting…'

  return (
    <div
      className={styles.root}
      data-active={active}
      data-testid={`browser-panel-${tab.id}`}
      hidden={!active}
    >
      <div className={styles.toolbar}>
        <Tooltip label="Back">
          <button
            type="button"
            className={styles.navBtn}
            onClick={goBack}
            disabled={!canGoBack}
            aria-label="Go back"
          >
            <ArrowLeft size={15} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip label="Forward">
          <button
            type="button"
            className={styles.navBtn}
            onClick={goForward}
            disabled={!canGoForward}
            aria-label="Go forward"
          >
            <ArrowRight size={15} aria-hidden />
          </button>
        </Tooltip>
        <Globe size={15} className={styles.brandIcon} aria-hidden />
        <div className={styles.urlBar}>
          <input
            className={styles.urlInput}
            value={pendingUrl}
            onChange={(e) => setPendingUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitUrl()
            }}
            placeholder={DEFAULT_PAGE_URL}
            spellCheck={false}
            aria-label="Page URL"
          />
          <button type="button" className={styles.goBtn} onClick={submitUrl}>
            Go
          </button>
        </div>
        <Tooltip label={endpoint || 'Annotation server endpoint'}>
          <span className={styles.statusPill} data-tone={statusTone} data-testid="browser-status">
            <span className={styles.statusDot} aria-hidden />
            {statusText}
          </span>
        </Tooltip>
      </div>

      <div className={styles.split} data-testid="browser-body">
        <div className={styles.browserColumn}>
          <div className={styles.frameWrap}>
            {loadedUrl && preloadPath ? (
              <webview
                key={`${tab.id}:${loadedUrl}`}
                ref={bindWebview as React.Ref<HTMLElement>}
                className={styles.webview}
                src={loadedUrl}
                preload={preloadPath}
                partition={AGENTATION_WEBVIEW_PARTITION}
                allowpopups="true"
              />
            ) : loadedUrl ? null : (
              <div className={styles.frameEmpty}>
                Enter a URL and press Go to load a page with the Agentation toolbar.
              </div>
            )}
          </div>
        </div>

        <aside className={styles.rail}>
          <div className={styles.railHeader}>Annotations</div>
          <div className={styles.railBody}>
            {!connected ? (
              <div className={styles.cta}>
                <div className={styles.ctaTitle}>Connecting to Agentation…</div>
                <p className={styles.ctaText}>
                  The embedded annotation server should start automatically at{' '}
                  <span className={styles.endpoint}>{endpoint}</span>.
                </p>
                <button
                  type="button"
                  className={styles.retryBtn}
                  onClick={() => void handleRetry()}
                  disabled={retrying}
                >
                  <RotateCw size={14} className={retrying ? styles.spin : undefined} aria-hidden />
                  {retrying ? 'Retrying…' : 'Retry'}
                </button>
              </div>
            ) : totalAnnotations === 0 ? (
              <div className={styles.empty}>
                <Globe size={24} aria-hidden />
                <div className={styles.emptyTitle}>No annotations yet</div>
                <p className={styles.emptyText}>
                  Annotate elements with the Agentation toolbar on the loaded page. Use Copy or Send
                  Annotations in the toolbar to copy markdown to your clipboard.
                </p>
              </div>
            ) : (
              <div className={styles.sessions}>
                {visibleSessions.map((session) => (
                  <section key={session.id} className={styles.session}>
                    <header className={styles.sessionHeader}>
                      <span className={styles.sessionTitle}>{sessionTitle(session)}</span>
                      {session.url ? <span className={styles.sessionUrl}>{session.url}</span> : null}
                    </header>
                    <ul className={styles.rows}>
                      <AnimatePresence initial={false}>
                        {session.annotations.map((annotation) => {
                          const busy = !!busyById[annotation.id]
                          return (
                            <motion.li
                              key={annotation.id}
                              className={styles.row}
                              layout
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                            >
                              <div className={styles.rowMain}>
                                <span className={styles.kind} data-kind={annotation.kind ?? 'feedback'}>
                                  {kindLabel(annotation.kind)}
                                </span>
                                <div className={styles.rowText}>
                                  {annotation.comment ? (
                                    <div className={styles.comment}>{annotation.comment}</div>
                                  ) : (
                                    <div className={styles.commentMuted}>(no comment)</div>
                                  )}
                                  {annotation.element ? (
                                    <div className={styles.element}>{annotation.element}</div>
                                  ) : null}
                                </div>
                              </div>
                              <div className={styles.actions}>
                                <Tooltip label="Resolve">
                                  <button
                                    type="button"
                                    className={styles.iconBtn}
                                    disabled={busy}
                                    onClick={() =>
                                      void withBusy(
                                        annotation.id,
                                        () => resolveAgentationAnnotation(annotation.id),
                                        'resolve',
                                      )
                                    }
                                    aria-label="Resolve"
                                  >
                                    <Check size={14} aria-hidden />
                                  </button>
                                </Tooltip>
                                <Tooltip label="Dismiss">
                                  <button
                                    type="button"
                                    className={styles.iconBtn}
                                    disabled={busy}
                                    onClick={() =>
                                      void withBusy(
                                        annotation.id,
                                        () => dismissAgentationAnnotation(annotation.id),
                                        'dismiss',
                                      )
                                    }
                                    aria-label="Dismiss"
                                  >
                                    <X size={14} aria-hidden />
                                  </button>
                                </Tooltip>
                              </div>
                            </motion.li>
                          )
                        })}
                      </AnimatePresence>
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
