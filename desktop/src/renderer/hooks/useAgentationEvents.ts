import { useEffect } from 'react'
import { useAppStore } from '../store/app-store'

const EMBEDDED_ENDPOINT = 'http://127.0.0.1:4747'

function agentationApi(): Window['api']['agentation'] | undefined {
  // Vite HMR can re-run renderer modules before the Electron preload exposes window.api.
  return typeof window !== 'undefined' ? window.api?.agentation : undefined
}

/**
 * Wires the renderer to the main-process Agentation service (embedded HTTP/SSE).
 */
export function useAgentationEvents(): void {
  const applyAgentationEvent = useAppStore((s) => s.applyAgentationEvent)
  const refreshAgentation = useAppStore((s) => s.refreshAgentation)
  const endpointOverride = useAppStore((s) => s.settings.agentationEndpoint)

  useEffect(() => {
    const api = agentationApi()
    if (!api) return
    return api.onEvent(applyAgentationEvent)
  }, [applyAgentationEvent])

  useEffect(() => {
    const timer = setTimeout(() => {
      const api = agentationApi()
      if (!api) return
      const endpoint = endpointOverride.trim() || EMBEDDED_ENDPOINT
      void api.setEndpoint(endpoint).then(() => refreshAgentation())
    }, 400)
    return () => clearTimeout(timer)
  }, [endpointOverride, refreshAgentation])

  useEffect(() => {
    void refreshAgentation()
  }, [refreshAgentation])
}

export function resolveAgentationEndpoint(
  statusEndpoint: string | undefined,
  settingsEndpoint: string,
): string {
  const override = settingsEndpoint.trim()
  if (override) return override.replace(/\/+$/, '')
  if (statusEndpoint) return statusEndpoint
  return EMBEDDED_ENDPOINT
}
