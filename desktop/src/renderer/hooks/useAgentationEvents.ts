import { useEffect } from 'react'
import { useAppStore } from '../store/app-store'

/**
 * Wires the renderer to the main-process Agentation service:
 *   - subscribes to forwarded SSE/status events (`AGENTATION_EVENT`) for the
 *     lifetime of the app and applies them to the store,
 *   - reconciles the service endpoint with the persisted setting (D7) and does
 *     the initial status + sessions load.
 *
 * Mount once near the app root (App.tsx). The main process owns the connection;
 * the renderer never talks to :4747 directly.
 */
export function useAgentationEvents(): void {
  const applyAgentationEvent = useAppStore((s) => s.applyAgentationEvent)
  const refreshAgentation = useAppStore((s) => s.refreshAgentation)
  const endpoint = useAppStore((s) => s.settings.agentationEndpoint)

  // Forwarded SSE/status events → store, for the app's lifetime.
  useEffect(() => {
    return window.api.agentation.onEvent(applyAgentationEvent)
  }, [applyAgentationEvent])

  // Apply endpoint changes to the service, debounced so typing in Settings
  // doesn't churn the SSE connection. setEndpoint is a no-op when unchanged, so
  // the mount run simply reconciles the service with the persisted value and
  // then refreshes status + sessions.
  useEffect(() => {
    const timer = setTimeout(() => {
      void window.api.agentation.setEndpoint(endpoint).then(() => refreshAgentation())
    }, 400)
    return () => clearTimeout(timer)
  }, [endpoint, refreshAgentation])
}
