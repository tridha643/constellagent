/** Accepts `/ws` (dev probes) and `/ws/<pairingSessionId>` (iPhone QR pairing URL). */
export function parseWebSocketUpgradePath(pathname: string): {
  accepted: boolean
  pairingSessionId?: string
} {
  if (pathname === '/ws') return { accepted: true }
  const prefix = '/ws/'
  if (!pathname.startsWith(prefix)) return { accepted: false }
  const pairingSessionId = decodeURIComponent(pathname.slice(prefix.length)).trim()
  if (!pairingSessionId || pairingSessionId.includes('/')) return { accepted: false }
  return { accepted: true, pairingSessionId }
}

export function buildMobileRelayWsUrl(host: string, port: number): string {
  return `ws://${host}:${port}/ws`
}
