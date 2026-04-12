import { app } from 'electron'
import { mkdir, rename, writeFile } from 'fs/promises'
import { existsSync, realpathSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { loadJsonFile } from './claude-config'

export interface StartupCommandRecord {
  name: string
  command: string
}

interface ProjectStartupSettingsEntry {
  startupCommands: StartupCommandRecord[]
  updatedAt: number
}

interface ProjectStartupSettingsFile {
  version: 1
  projects: Record<string, ProjectStartupSettingsEntry>
}

const DEFAULT_SETTINGS_FILE: ProjectStartupSettingsFile = {
  version: 1,
  projects: {},
}

function normalizeRepoKey(repoPath: string): string {
  try {
    return realpathSync(repoPath)
  } catch {
    return resolve(repoPath)
  }
}

function normalizeStartupCommands(raw: unknown): StartupCommandRecord[] {
  if (!Array.isArray(raw)) return []
  const out: StartupCommandRecord[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const command = typeof record.command === 'string' ? record.command : ''
    if (!command.trim()) continue
    out.push({
      name: typeof record.name === 'string' ? record.name : '',
      command,
    })
  }
  return out
}

function projectStartupSettingsPath(): string {
  const override = process.env.CONSTELLAGENT_PROJECT_SETTINGS_PATH?.trim()
  if (override) return resolve(override)
  return join(app.getPath('desktop'), '.constellagent-project-settings.json')
}

async function loadProjectStartupSettingsFile(): Promise<ProjectStartupSettingsFile> {
  const loaded = await loadJsonFile<unknown>(projectStartupSettingsPath(), DEFAULT_SETTINGS_FILE)
  if (!loaded || typeof loaded !== 'object') return { ...DEFAULT_SETTINGS_FILE }

  const record = loaded as Record<string, unknown>
  const projects = record.projects
  const normalizedProjects: Record<string, ProjectStartupSettingsEntry> = {}

  if (projects && typeof projects === 'object') {
    for (const [repoPath, value] of Object.entries(projects as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const entry = value as Record<string, unknown>
      const startupCommands = normalizeStartupCommands(entry.startupCommands)
      if (startupCommands.length === 0) continue
      const key = normalizeRepoKey(repoPath)
      normalizedProjects[key] = {
        startupCommands,
        updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
      }
    }
  }

  return {
    version: 1,
    projects: normalizedProjects,
  }
}

async function saveProjectStartupSettingsFile(data: ProjectStartupSettingsFile): Promise<void> {
  const filePath = projectStartupSettingsPath()
  await mkdir(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp`
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  await rename(tmpPath, filePath)
}

export async function listProjectStartupSettings(): Promise<Record<string, StartupCommandRecord[]>> {
  const data = await loadProjectStartupSettingsFile()
  return Object.fromEntries(
    Object.entries(data.projects).map(([repoPath, entry]) => [repoPath, entry.startupCommands]),
  )
}

export async function getProjectStartupCommands(repoPath: string): Promise<StartupCommandRecord[] | null> {
  if (!repoPath.trim()) return null
  const data = await loadProjectStartupSettingsFile()
  const key = normalizeRepoKey(repoPath)
  return data.projects[key]?.startupCommands ?? null
}

export async function setProjectStartupCommands(repoPath: string, startupCommands: unknown): Promise<StartupCommandRecord[]> {
  const key = normalizeRepoKey(repoPath)
  const normalizedCommands = normalizeStartupCommands(startupCommands)
  const data = await loadProjectStartupSettingsFile()

  if (normalizedCommands.length === 0) {
    delete data.projects[key]
  } else {
    data.projects[key] = {
      startupCommands: normalizedCommands,
      updatedAt: Date.now(),
    }
  }

  await saveProjectStartupSettingsFile(data)
  return normalizedCommands
}

export async function deleteProjectStartupCommands(repoPath: string): Promise<void> {
  const key = normalizeRepoKey(repoPath)
  const data = await loadProjectStartupSettingsFile()
  if (!data.projects[key]) return
  delete data.projects[key]
  await saveProjectStartupSettingsFile(data)
}

export function getProjectStartupSettingsPath(): string {
  return projectStartupSettingsPath()
}

export function projectStartupSettingsExists(): boolean {
  return existsSync(projectStartupSettingsPath())
}
