declare module '@mariozechner/pi-coding-agent' {
  export interface ExtensionContext {
    cwd: string
    hasUI?: boolean
    model?: { provider: string; id: string } | null
    ui: any
    sessionManager: any
  }

  export interface ExtensionAPI {
    registerTool(tool: any): void
    registerCommand(name: string, command: any): void
    registerFlag?(name: string, flag: any): void
    on(name: string, handler: any): void
    getActiveTools(): string[]
    setActiveTools(names: string[]): void
  }
}

declare module '@mariozechner/pi-tui' {
  export class Text {
    constructor(text: string, x: number, y: number)
  }
}

declare module '@sinclair/typebox' {
  export const Type: any
}
