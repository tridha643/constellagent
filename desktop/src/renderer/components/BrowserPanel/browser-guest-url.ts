/**
 * Absolute URL of the bundled browser-guest script (for webview injection).
 * Dev: Vite serves the separate rollup entry from the renderer dev server.
 * Prod: sibling chunk next to the main renderer bundle.
 */
export function getBrowserGuestScriptUrl(): string {
  if (import.meta.env.DEV) {
    // In dev, Vite serves the source module (the built `browser-guest.js`
    // bundle only exists in production). Point at the rollup entry source.
    const base = import.meta.env.VITE_DEV_SERVER_URL ?? window.location.origin
    return new URL('browser-guest/main.tsx', base.endsWith('/') ? base : `${base}/`).href
  }
  return new URL('../browser-guest.js', import.meta.url).href
}
