import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface TaskHandoffManifest {
  schemaVersion: 1
  plan: {
    path: string
    title: string
    createdAt: number
    updatedAt: number
    codingAgent: string | null
    prompt: string | null
    clarifications: string | null
  }
  seed: {
    taskFile: string
    taskCount: number
    source: 'phase-headings'
    preservedExistingTasks: boolean
  }
}

export function sanitizeWorkspaceId(workspaceId: string): string {
  return workspaceId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'workspace'
}

export function getWorkspaceTaskRoot(workspaceId: string): string {
  return join(homedir(), '.pi', sanitizeWorkspaceId(workspaceId), 'tasks')
}

export function getWorkspaceTaskManifestPath(workspaceId: string): string {
  return join(getWorkspaceTaskRoot(workspaceId), 'handoff.json')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
}

export async function loadTaskHandoff(workspaceId: string | null): Promise<TaskHandoffManifest | null> {
  if (!workspaceId) return null
  const manifestPath = getWorkspaceTaskManifestPath(workspaceId)
  if (!(await fileExists(manifestPath))) return null
  try {
    return JSON.parse(await readFile(manifestPath, 'utf-8')) as TaskHandoffManifest
  } catch {
    return null
  }
}

export async function readStoredPlanExcerpt(planPath: string): Promise<string | null> {
  try {
    const text = await readFile(resolve(planPath), 'utf-8')
    return stripFrontmatter(text).split(/\r?\n/).slice(0, 30).join('\n').trim() || null
  } catch {
    return null
  }
}
