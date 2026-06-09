import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronLeft, Copy, Globe, MousePointerClick, RotateCw, Send, X } from 'lucide-react'
import { useAppStore } from '../../store/app-store'
import { annotationToMarkdown } from '../../../shared/agentation-types'
import type { AgentationAnnotation, AgentationSession } from '../../../shared/agentation-types'
import { FloatingPanel } from '../FloatingPanel/FloatingPanel'
import { Tooltip } from '../Tooltip/Tooltip'
import { buildAgentationInjectScript } from './agentation-inject'
import { getBrowserGuestScriptUrl } from './browser-guest-url'
import styles from './BrowserPanel.module.css'

const SERVER_COMMAND = 'npx agentation-mcp server'

type WorkspaceBrowserState = {
  url: string
  pendingUrl: string
}

const workspaceCache = new Map<string, WorkspaceBrowserState>()

function defaultBrowserState(): WorkspaceBrowserState {
  return { url: '', pendingUrl: 'http://localhost:5173' }
}

function kindLabel(kind: AgentationAnnotation['kind']): string {
  if (kind === 'placement') return 'Placement'
  if (kind === 'rearrange') return 'Rearrange'
  return 'Feedback'
}

function sessionTitle(session: AgentationSession): string {
  if (session.id === '__ungrouped__') return 'Annotations'
  return session.title?.trim() || session.url || session.id
}

export function BrowserPanel() {
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const toggleBrowser = useAppStore((s) => s.toggleBrowser)
  const status = useAppStore((s) => s.agentationStatus)
  const sessions = useAppStore((s) => s.agentationSessions)
  const agentationEndpoint = useAppStore((s) => s.settings.agentationEndpoint)
  const refreshAgentation = useAppStore((s) => s.refreshAgentation)
  const sendAgentationAnnotation = useAppStore((s) => s.sendAgentationAnnotation)
  const resolveAgentationAnnotation = useAppStore((s) => s.resolveAgentationAnnotation)
  const dismissAgentationAnnotation = useAppStore((s) => s.dismissAgentationAnnotation)
  const addToast = useAppStore((s) => s.addToast)

  const initial = activeWorkspaceId
    ? (workspaceCache.get(activeWorkspaceId) ?? defaultBrowserState())
    : defaultBrowserState()
  const [url, setUrl] = useState(initial.url)
  const [pendingUrl, setPendingUrl] = useState(initial.pendingUrl)
  const [retrying, setRetrying] = useState(false)
  const [busyById, setBusyById] = useState<Record<string, boolean>>({})

  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const webviewCleanupRef = useRef<(() => void) | null>(null)
  const guestScriptUrl = useMemo(() => getBrowserGuestScriptUrl(), [])

  useEffect(() => {
    if (!activeWorkspaceId) return
    workspaceCache.set(activeWorkspaceId, { url, pendingUrl })
  }, [activeWorkspaceId, url, pendingUrl])

  useEffect(() => {
    if (!activeWorkspaceId) return
    const cached = workspaceCache.get(activeWorkspaceId) ?? defaultBrowserState()
    setUrl(cached.url)
    setPendingUrl(cached.pendingUrl)
  }, [activeWorkspaceId])

  const injectAgentation = useCallback(
    (opts?: { quiet?: boolean }) => {
      const wv = webviewRef.current
      if (!wv || !url) {
        if (!opts?.quiet) {
          addToast({
            id: `browser-annotate-no-page-${Date.now()}`,
            message: 'Load a URL first',
            type: 'warning',
          })
        }
        return
      }
      const script = buildAgentationInjectScript(agentationEndpoint, guestScriptUrl)
      wv.executeJavaScript(script).catch(() => {
        addToast({
          id: `browser-annotate-inject-${Date.now()}`,
          message: 'Could not inject the annotation toolbar into this page',
          type: 'error',
        })
      })
    },
    [url, agentationEndpoint, guestScriptUrl, addToast],
  )

  const bindWebview = useCallback(
    (node: Electron.WebviewTag | null) => {
      if (webviewCleanupRef.current) {
        webviewCleanupRef.current()
        webviewCleanupRef.current = null
      }
      webviewRef.current = node
      if (!node || !url) return
      const onDomReady = () => injectAgentation({ quiet: true })
      node.addEventListener('dom-ready', onDomReady)
      webviewCleanupRef.current = () => node.removeEventListener('dom-ready', onDomReady)
    },
    [url, injectAgentation],
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
    setUrl(normalized)
    setPendingUrl(normalized)
  }, [pendingUrl])

  const connected = status?.connected ?? false
  const reconnecting = status?.reconnecting ?? false
  const endpoint = status?.endpoint ?? agentationEndpoint

  const visibleSessions = useMemo(
    () => sessions.filter((s) => s.annotations.length > 0),
    [sessions],
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

  const handleCopyCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(SERVER_COMMAND)
      addToast({ id: `browser-copy-${Date.now()}`, message: 'Copied command', type: 'info' })
    } catch {
      addToast({ id: `browser-copy-err-${Date.now()}`, message: 'Could not copy', type: 'error' })
    }
  }, [addToast])

  const handleSend = useCallback(
    (annotation: AgentationAnnotation) => {
      sendAgentationAnnotation(annotationToMarkdown(annotation))
    },
    [sendAgentationAnnotation],
  )

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
  const statusText = connected ? 'Connected' : reconnecting ? 'Reconnecting…' : 'Not running'

  return (
    <FloatingPanel variant="fullscreen" testId="browser-panel">
      <FloatingPanel.Titlebar trafficLightPad>
        <div className={styles.header}>
          <Tooltip label="Back">
            <button
              type="button"
              className={styles.backBtn}
              onClick={toggleBrowser}
              aria-label="Close Browser"
            >
              <ChevronLeft size={16} strokeWidth={2} aria-hidden />
            </button>
          </Tooltip>
          <Globe size={16} className={styles.brandIcon} aria-hidden />
          <span className={styles.brandTitle}>Browser</span>
          <Tooltip label={endpoint || 'Annotation server endpoint'}>
            <span className={styles.statusPill} data-tone={statusTone} data-testid="browser-status">
              <span className={styles.statusDot} aria-hidden />
              {statusText}
            </span>
          </Tooltip>
        </div>
      </FloatingPanel.Titlebar>

      <div className={styles.split} data-testid="browser-body">
        <div className={styles.browserColumn}>
          <div className={styles.urlBar}>
            <input
              className={styles.urlInput}
              value={pendingUrl}
              onChange={(e) => setPendingUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitUrl()
              }}
              placeholder="http://localhost:5173"
              spellCheck={false}
              aria-label="Page URL"
            />
            <button type="button" className={styles.goBtn} onClick={submitUrl}>
              Go
            </button>
          </div>
          <div className={styles.annotateBar}>
            <button
              type="button"
              className={styles.annotateBtn}
              disabled={!url}
              onClick={() => injectAgentation()}
            >
              <MousePointerClick size={15} aria-hidden />
              Annotate
            </button>
            <span className={styles.annotateHint}>
              {url
                ? 'Click Annotate, then use the ◎ control in the bottom-right of the page.'
                : 'Load a page to enable element annotations.'}
            </span>
          </div>
          <div className={styles.frameWrap}>
            {url ? (
              <webview
                key={url}
                ref={bindWebview as React.Ref<HTMLElement>}
                className={styles.webview}
                src={url}
                allowpopups
              />
            ) : (
              <div className={styles.frameEmpty}>Enter a URL and press Go to load a page with the Agentation toolbar.</div>
            )}
          </div>
        </div>

        <aside className={styles.rail}>
          <div className={styles.railHeader}>Annotations</div>
          <div className={styles.railBody}>
            {!connected ? (
              <div className={styles.cta}>
                <div className={styles.ctaTitle}>Annotation server isn’t running</div>
                <p className={styles.ctaText}>
                  Start the local server so annotations from this browser sync here. Pages load the
                  Agentation toolbar automatically at <span className={styles.endpoint}>{endpoint}</span>.
                </p>
                <div className={styles.command}>
                  <code>{SERVER_COMMAND}</code>
                  <Tooltip label="Copy">
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => void handleCopyCommand()}
                      aria-label="Copy command"
                    >
                      <Copy size={14} aria-hidden />
                    </button>
                  </Tooltip>
                </div>
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
                  Use the Agentation toolbar on the loaded page to annotate elements. They appear here
                  for review and sending to your agent.
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
                                <Tooltip label="Send to agent">
                                  <button
                                    type="button"
                                    className={styles.sendBtn}
                                    onClick={() => handleSend(annotation)}
                                    aria-label="Send to agent"
                                  >
                                    <Send size={13} aria-hidden />
                                    Send
                                  </button>
                                </Tooltip>
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
    </FloatingPanel>
  )
}
