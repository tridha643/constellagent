import { contextBridge, ipcRenderer } from 'electron'

/**
 * Minimal bridge for Agentation callbacks inside Browser webviews.
 * Uses sendToHost → BrowserPanel ipc-message listener in the parent renderer.
 */
contextBridge.exposeInMainWorld('constellagentAgentationBridge', {
  copyMarkdown: (markdown: string) => {
    ipcRenderer.sendToHost('agentation:copy', markdown)
  },
  submitAnnotations: (output: string) => {
    ipcRenderer.sendToHost('agentation:submit', output)
  },
  sessionCreated: (sessionId: string) => {
    ipcRenderer.sendToHost('agentation:session-created', sessionId)
  },
})
