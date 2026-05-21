import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // @openai/codex-sdk is ESM-only (exports.import, no require). Bundle it so the
    // CJS main output does not call require("@openai/codex-sdk") at runtime.
    build: {
      externalizeDeps: {
        exclude: ['@openai/codex-sdk'],
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
