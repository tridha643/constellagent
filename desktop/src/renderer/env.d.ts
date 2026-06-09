/// <reference types="vite/client" />

import type { ElectronAPI } from '../preload/index'

declare global {
  interface Window {
    api: ElectronAPI
  }

  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        webview: React.DetailedHTMLProps<Electron.WebviewHTMLAttributes, Electron.WebviewTag>
      }
    }
  }
}

declare module '*.module.css' {
  const classes: { [key: string]: string }
  export default classes
}
