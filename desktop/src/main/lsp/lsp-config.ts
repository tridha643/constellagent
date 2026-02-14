import { execFileSync } from 'child_process'

export interface LspServerConfig {
  language: string
  command: string
  args: string[]
  /** File extensions this server handles */
  extensions: string[]
}

export const LSP_SERVERS: LspServerConfig[] = [
  {
    language: 'python',
    command: 'pyright-langserver',
    args: ['--stdio'],
    extensions: ['.py'],
  },
  {
    language: 'go',
    command: 'gopls',
    args: ['serve'],
    extensions: ['.go'],
  },
  {
    language: 'rust',
    command: 'rust-analyzer',
    args: [],
    extensions: ['.rs'],
  },
]

export function isServerAvailable(command: string): boolean {
  try {
    execFileSync('which', [command], { encoding: 'utf-8', stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function getServerConfig(language: string): LspServerConfig | undefined {
  return LSP_SERVERS.find((s) => s.language === language)
}

export function getAvailableLanguages(): string[] {
  return LSP_SERVERS.filter((s) => isServerAvailable(s.command)).map((s) => s.language)
}
