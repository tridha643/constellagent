import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // @openai/codex-sdk is ESM-only (exports.import, no require). Bundle it so the
    // CJS main output does not call require("@openai/codex-sdk") at runtime.
    build: {
      externalizeDeps: {
        exclude: ['@openai/codex-sdk', '@constellagent/mobile-protocol'],
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      // No legacy modulepreload polyfill — the renderer only ever runs in the
      // bundled Electron Chromium, which supports `<link rel=modulepreload>`.
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
        output: {
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
      ...(process.env.CONSTELLAGENT_VITE_PORT
        ? { port: Number.parseInt(process.env.CONSTELLAGENT_VITE_PORT, 10) || 5173 }
        : process.env.CONSTELL_PORT
          ? { port: Number(process.env.CONSTELL_PORT) }
          : {}),
    },
  }
})
