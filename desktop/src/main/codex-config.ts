import { homedir } from 'os'
import { join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'

export const CODEX_DIR = join(homedir(), '.codex')
export const CODEX_CONFIG_PATH = join(CODEX_DIR, 'config.toml')

export type CodexPersonality = 'pragmatic' | 'friendly' | 'none'

const PERSONALITY_LINE_RE = /^\s*personality\s*=.*$/im
const TABLE_HEADER_RE = /^\s*\[[^\n]+\]\s*$/m

function firstTableHeaderIndex(configText: string): number {
  const match = configText.match(TABLE_HEADER_RE)
  return match?.index ?? -1
}

function topLevelSection(configText: string): string {
  const firstTableIndex = firstTableHeaderIndex(configText)
  return firstTableIndex === -1 ? configText : configText.slice(0, firstTableIndex)
}

export function upsertCodexPersonalityLine(configText: string, personality: CodexPersonality): string {
  const line = `personality = "${personality}"`
  const topLevel = topLevelSection(configText)
  if (PERSONALITY_LINE_RE.test(topLevel)) {
    const firstTableIndex = firstTableHeaderIndex(configText)
    const updatedTop = topLevel.replace(PERSONALITY_LINE_RE, line).replace(/\n{3,}/g, '\n\n').trimEnd()
    if (firstTableIndex === -1) {
      return updatedTop ? `${updatedTop}\n` : `${line}\n`
    }
    const rest = configText.slice(firstTableIndex)
    return `${updatedTop}\n\n${rest}`.replace(/\n{3,}/g, '\n\n')
  }
  const trimmed = configText.trimEnd()
  if (!trimmed) return `${line}\n`
  return `${trimmed}\n${line}\n`
}

export function parseCodexPersonality(configText: string): CodexPersonality {
  const match = configText.match(/^\s*personality\s*=\s*["']?([a-z]+)["']?\s*$/im)
  const value = match?.[1]?.trim().toLowerCase()
  if (value === 'friendly' || value === 'none' || value === 'pragmatic') {
    return value
  }
  return 'pragmatic'
}

export async function getCodexPersonality(): Promise<CodexPersonality> {
  const configText = await loadCodexConfigText()
  return parseCodexPersonality(configText)
}

export async function loadCodexConfigText(): Promise<string> {
  try {
    return await readFile(CODEX_CONFIG_PATH, 'utf-8')
  } catch {
    return ''
  }
}

export async function saveCodexConfigText(contents: string): Promise<void> {
  await mkdir(CODEX_DIR, { recursive: true })
  await writeFile(CODEX_CONFIG_PATH, contents, 'utf-8')
}

export async function setCodexPersonality(personality: CodexPersonality): Promise<CodexPersonality> {
  const configText = await loadCodexConfigText()
  await saveCodexConfigText(upsertCodexPersonalityLine(configText, personality))
  return personality
}
