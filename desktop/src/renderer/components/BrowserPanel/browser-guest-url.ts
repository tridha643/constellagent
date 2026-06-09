/**
 * Absolute URL of the bundled browser-guest script (for webview injection).
 * Dev: Vite serves the separate rollup entry from the renderer dev server.
 * Prod: sibling chunk next to the main renderer bundle.
 */
export function getBrowserGuestScriptUrl(): string {
  if (import.meta.env.DEV) {
    const base = import.meta.env.VITE_DEV_SERVER_URL ?? window.location.origin
    return new URL('browser-guest.js', base.endsWith('/') ? base : `${base}/`).href
  }
  return new URL('../browser-guest.js', import.meta.url).href
}
