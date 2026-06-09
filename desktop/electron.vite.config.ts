import { defineConfig, type Plugin } from 'electron-vite'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'
import { indexHtmlCachePlugin } from './scripts/vite-index-html-cache-plugin'

/**
 * Rolldown's CJS main bundle replaces bare `import.meta` with `{}`, which breaks
 * `import.meta.resolve()` in @mariozechner/pi-coding-agent's extension loader.
 * Rewrite to `createRequire(import.meta.url).resolve()` before bundling; Rolldown
 * already lowers `import.meta.url` to `pathToFileURL(__filename)`.
 */
function piCodingAgentImportMetaResolve(): Plugin {
  return {
    name: 'pi-coding-agent-import-meta-resolve',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('pi-coding-agent') || !code.includes('import.meta.resolve')) {
        return undefined
      }
      const next = code.replace(
        /fileURLToPath\(\s*import\.meta\.resolve\(([^)]+)\)\s*\)/g,
        'createRequire(import.meta.url).resolve($1)',
      )
      if (next === code) return undefined
      return { code: next, map: null }
    },
  }
}

const rendererRoot = resolve(__dirname, 'src/renderer')
const rendererIndexHtml = resolve(rendererRoot, 'index.html')
const repoRoot = resolve(__dirname, '..')
const piGuiRoot = resolve(__dirname, 'src/lib/pi-gui')

const piGuiAliases = {
  '@pi-gui/session-driver': resolve(piGuiRoot, 'session-driver/index.ts'),
  '@pi-gui/session-driver/types': resolve(piGuiRoot, 'session-driver/types.ts'),
  '@pi-gui/session-driver/runtime-types': resolve(piGuiRoot, 'session-driver/runtime-types.ts'),
  '@pi-gui/catalogs': resolve(piGuiRoot, 'catalogs/index.ts'),
  '@pi-gui/pi-sdk-driver': resolve(piGuiRoot, 'pi-sdk-driver/index.ts'),
}

export default defineConfig({
  main: {
    plugins: [piCodingAgentImportMetaResolve()],
    // ESM-only deps (exports.import, no require). Bundle them so the CJS main
    // output does not call require() on them at runtime.
    build: {
      externalizeDeps: {
        exclude: [
          '@openai/codex-sdk',
          '@constellagent/mobile-protocol',
          '@mariozechner/pi-coding-agent',
          '@mariozechner/pi-tui',
        ],
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        ...piGuiAliases,
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        ...piGuiAliases,
      }
    }
  },
  renderer: {
    root: rendererRoot,
    worker: {
      format: 'es',
    },
    plugins: [indexHtmlCachePlugin(rendererIndexHtml), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared'),
        ...piGuiAliases,
      }
    },
    build: {
      // No legacy modulepreload polyfill — the renderer only ever runs in the
      // bundled Electron Chromium, which supports `<link rel=modulepreload>`.
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: {
          index: rendererIndexHtml,
          'browser-guest': resolve(rendererRoot, 'browser-guest/main.tsx'),
        },
        output: {
          entryFileNames: (chunkInfo) =>
            chunkInfo.name === 'browser-guest' ? 'browser-guest.js' : 'assets/[name]-[hash].js',
          // Split node_modules into per-package vendor chunks instead of one
          // ~8.7 MB monolithic `index` chunk. Vendor code rarely changes, so
          // each library lands in its own stable, separately-cacheable chunk:
          // Chromium's per-script V8 code cache survives app updates (only the
          // small app chunk recompiles on a warm launch), and cache
          // invalidation becomes per-library instead of per-app-revision.
          // (linear-local-first principle 5 — "ship less code in more pieces".)
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            // CSS/asset ids go through Vite's own pipeline — leave them alone.
            if (/\.(css|scss|sass|less|png|svg|woff2?|ttf)$/.test(id)) return undefined
            // Resolve the innermost package name (handles nested + scoped deps).
            const afterLast = id.split('node_modules/').pop() ?? ''
            const seg = afterLast.split('/')
            const pkg = seg[0]?.startsWith('@') ? `${seg[0]}/${seg[1]}` : seg[0]
            if (!pkg) return undefined
            // These ship one dynamically-imported file per language/theme/mode,
            // which Shiki/CodeMirror load on demand. Leave them to Rollup's
            // default per-dynamic-import chunking so highlighting one language
            // doesn't pull every grammar — grouping them would regress that.
            if (
              pkg === '@shikijs/langs' ||
              pkg === '@shikijs/themes' ||
              pkg === '@codemirror/legacy-modes'
            ) {
              return undefined
            }
            // Keep the React runtime in a single chunk. Splitting
            // react/react-dom/scheduler across chunks risks duplicate
            // instances and module init-order bugs around React context.
            if (/^(react|react-dom|scheduler|use-sync-external-store|object-assign)$/.test(pkg)) {
              return 'vendor-react'
            }
            return `vendor-${pkg.replace('@', '').replace('/', '-')}`
          },
        },
      },
    },
    server: {
      strictPort: false,
      fs: {
        // Monorepo packages + repo root; avoids dev-server denials outside rendererRoot.
        allow: [rendererRoot, repoRoot],
      },
      ...(process.env.CONSTELLAGENT_VITE_PORT
        ? { port: Number.parseInt(process.env.CONSTELLAGENT_VITE_PORT, 10) || 5173 }
        : process.env.CONSTELL_PORT
          ? { port: Number(process.env.CONSTELL_PORT) }
          : {}),
    },
  }
})
