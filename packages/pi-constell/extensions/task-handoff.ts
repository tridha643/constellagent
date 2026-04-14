import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const TASKS_ROOT = '.pi'
const TASKS_FILE = 'tasks.json'
const HANDOFF_FILE = 'handoff.json'

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

interface SeedTask {
  id: string
  subject: string
  description: string
  status: TaskStatus
  metadata: Record<string, unknown>
  blocks: string[]
  blockedBy: string[]
  output: string[]
  createdAt: number
  updatedAt: number
}

interface TaskStoreData {
  schemaVersion: 1
  nextId: number
  tasks: SeedTask[]
}

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

export interface TaskHandoffContext {
  workspaceId: string | null
  planPath: string
  planTitle: string
  planText: string
  codingAgent: string | null
  prompt: string | null
  clarifications: string | null
}

export function sanitizeWorkspaceId(workspaceId: string): string {
  return workspaceId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'workspace'
}

export function getWorkspaceTaskRoot(workspaceId: string): string {
  return join(homedir(), TASKS_ROOT, sanitizeWorkspaceId(workspaceId), 'tasks')
}

export function getWorkspaceTaskManifestPath(workspaceId: string): string {
  return join(getWorkspaceTaskRoot(workspaceId), HANDOFF_FILE)
}

function extractPhaseSections(planText: string): Array<{ heading: string; body: string; index: number }> {
  const lines = planText.split(/\r?\n/)
  const sections: Array<{ heading: string; body: string; index: number }> = []
  let current: { heading: string; lines: string[]; index: number } | null = null

  for (const line of lines) {
    const heading = line.match(/^\s*###\s+(Phase\s+\d+[^\n]*)\s*$/i) ?? line.match(/^\s*##\s+(Phase\s+\d+[^\n]*)\s*$/i)
    if (heading) {
      if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim(), index: current.index })
      current = { heading: heading[1].trim(), lines: [], index: sections.length + 1 }
      continue
    }
    if (current) current.lines.push(line)
  }

  if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim(), index: current.index })
  return sections
}

function extractGoal(body: string): string | null {
  const goalLine = body.match(/^\s*[-*]\s+Goal:\s+(.+)$/im)
  return goalLine?.[1]?.trim() || null
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
}

function buildSeedTasks(planPath: string, planTitle: string, planText: string): TaskStoreData {
  const cleaned = stripFrontmatter(planText)
  const phases = extractPhaseSections(cleaned)
  const createdAt = Date.now()
  const tasks: SeedTask[] = phases.map((phase, index) => {
    const id = String(index + 1)
    const goal = extractGoal(phase.body)
    const subject = goal ? `${phase.heading}: ${goal}` : phase.heading
    return {
      id,
      subject,
      description: phase.body || phase.heading,
      status: 'pending',
      metadata: {
        source: 'pi-constell-plan',
        planPath,
        planTitle,
        phaseHeading: phase.heading,
        phaseIndex: index + 1,
      },
      blocks: index < phases.length - 1 ? [String(index + 2)] : [],
      blockedBy: index > 0 ? [String(index)] : [],
      output: [],
      createdAt,
      updatedAt: createdAt,
    }
  })

  return {
    schemaVersion: 1,
    nextId: tasks.length + 1,
    tasks,
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readTaskStore(path: string): Promise<TaskStoreData | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as TaskStoreData
  } catch {
    return null
  }
}

export function buildTaskHandoffPrompt(workspaceId: string | null): string {
  if (!workspaceId) {
    return 'Durable task handoff is unavailable for this session because AGENT_ORCH_WS_ID is missing. Save only the plan file and make the missing task handoff explicit in the plan.'
  }
  return `On save, seed durable task handoff files only under ~/.pi/<workspaceId>/tasks/ so a separate pi task extension can continue this plan from the same workspace. Write clear phase headings and task breakdowns because those sections seed the initial workspace task graph.`
}

export async function writeTaskHandoff(context: TaskHandoffContext): Promise<TaskHandoffManifest | null> {
  if (!context.workspaceId) return null

  const rootPath = getWorkspaceTaskRoot(context.workspaceId)
  const manifestPath = getWorkspaceTaskManifestPath(context.workspaceId)
  const taskFilePath = resolve(rootPath, TASKS_FILE)
  await mkdir(rootPath, { recursive: true })

  const existingStore = await readTaskStore(taskFilePath)
  const shouldPreserveExistingTasks = Boolean(existingStore && existingStore.tasks.length > 0)
  const store = shouldPreserveExistingTasks ? existingStore! : buildSeedTasks(context.planPath, context.planTitle, context.planText)

  if (!shouldPreserveExistingTasks) {
    await writeFile(taskFilePath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8')
  }

  const now = Date.now()
  const previousManifest = await loadTaskHandoff(context.workspaceId)
  const manifest: TaskHandoffManifest = {
    schemaVersion: 1,
    plan: {
      path: context.planPath,
      title: context.planTitle,
      createdAt: previousManifest?.plan.createdAt ?? now,
      updatedAt: now,
      codingAgent: context.codingAgent,
      prompt: context.prompt,
      clarifications: context.clarifications,
    },
    seed: {
      taskFile: taskFilePath,
      taskCount: store.tasks.length,
      source: 'phase-headings',
      preservedExistingTasks: shouldPreserveExistingTasks,
    },
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
  return manifest
}

export async function loadTaskHandoff(workspaceId: string): Promise<TaskHandoffManifest | null> {
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

export function getTaskSeedFileName(): string {
  return TASKS_FILE
}

export function getTaskHandoffFileName(): string {
  return HANDOFF_FILE
}

export async function removeWorkspaceTaskRoot(workspaceId: string): Promise<void> {
  await rm(getWorkspaceTaskRoot(workspaceId), { recursive: true, force: true }).catch(() => {})
}

