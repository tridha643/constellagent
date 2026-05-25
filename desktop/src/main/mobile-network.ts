import { networkInterfaces } from 'node:os'

const PREFERRED_INTERFACE_PREFIXES = ['en0', 'en1', 'wlan', 'wifi', 'eth']

export function isElectronDevSession(): boolean {
  return !!process.env.ELECTRON_RENDERER_URL
}

export function isMobileAccessEnabled(explicitEnabled?: boolean): boolean {
  if (typeof explicitEnabled === 'boolean') return explicitEnabled
  const env = process.env.CONSTELLAGENT_MOBILE_ACCESS?.trim().toLowerCase()
  if (env === '0' || env === 'false' || env === 'no') return false
  if (env === '1' || env === 'true' || env === 'yes') return true
  return isElectronDevSession()
}

/** Host the HTTP/WebSocket server binds to. */
export function resolveMobileListenHost(configuredHost?: string): string {
  const trimmed = configuredHost?.trim()
  if (trimmed) return trimmed
  if (isElectronDevSession()) return '0.0.0.0'
  return detectTailscaleAddress() || detectPrivateLanAddress() || '127.0.0.1'
}

/** Host advertised in pairing URLs and /mobile/status (never 0.0.0.0). */
export function resolveMobileAdvertisedHost(configuredHost?: string, listenHost?: string): string {
  const trimmed = configuredHost?.trim()
  if (trimmed) return trimmed
  return (
    detectPrivateLanAddress()
    || detectTailscaleAddress()
    || (listenHost && listenHost !== '0.0.0.0' ? listenHost : null)
    || '127.0.0.1'
  )
}

export function detectTailscaleAddress(): string | null {
  return listTailscaleAddresses()[0] ?? null
}

export function listTailscaleAddresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (isTailscaleIpv4(entry.address)) addresses.push(entry.address)
    }
  }
  return addresses.sort()
}

export function detectPrivateLanAddress(): string | null {
  const candidates: Array<{ address: string; priority: number }> = []

  for (const [name, entries] of Object.entries(networkInterfaces())) {
    const lowerName = name.toLowerCase()
    let priority = PREFERRED_INTERFACE_PREFIXES.length
    for (let index = 0; index < PREFERRED_INTERFACE_PREFIXES.length; index += 1) {
      if (lowerName.startsWith(PREFERRED_INTERFACE_PREFIXES[index]!)) {
        priority = index
        break
      }
    }

    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (!isPrivateIpv4(entry.address) || isTailscaleIpv4(entry.address)) continue
      candidates.push({ address: entry.address, priority })
    }
  }

  candidates.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority
    return left.address.localeCompare(right.address)
  })

  return candidates[0]?.address ?? null
}

export function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }
  const [a, b] = parts
  if (a === 10) return true
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

export function isTailscaleIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
  const [a, b] = parts
  if (a !== 100 || b === undefined) return false
  return b >= 64 && b <= 127
}
