import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

/**
 * Serve renderer index.html from an in-memory cache when macOS TCC/sandbox
 * denies runtime disk reads (EPERM) — common for repos on Desktop started from
 * IDE sandboxes. Cache is populated at dev-server startup and on HMR updates.
 */
export function indexHtmlCachePlugin(indexHtmlPath: string): Plugin {
  let cachedHtml: string | null = null

  const refreshCache = (): string | null => {
    try {
      const html = readFileSync(indexHtmlPath, 'utf-8')
      cachedHtml = html
      return html
    } catch {
      return cachedHtml
    }
  }

  return {
    name: 'constellagent:index-html-cache',
    configureServer(server) {
      const initial = refreshCache()
      if (!initial) {
        server.config.logger.warn(
          `[constellagent] Could not read ${indexHtmlPath} at dev-server startup. ` +
            'Grant Full Disk Access to your terminal/IDE, or move the repo off Desktop/Documents.',
        )
      }

      server.middlewares.use(async (req, res, next) => {
        if (res.writableEnded) return next()

        const pathname = req.url?.split('?')[0] ?? ''
        if (pathname !== '/' && pathname !== '/index.html') return next()
        if (req.headers['sec-fetch-dest'] === 'script') return next()

        const html = refreshCache()
        if (!html) return next()

        try {
          const transformed = await server.transformIndexHtml(pathname, html, req.originalUrl)
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html')
          res.end(transformed)
        } catch (error) {
          next(error)
        }
      })
    },
    handleHotUpdate(ctx) {
      if (ctx.file === indexHtmlPath) {
        refreshCache()
      }
    },
  }
}
