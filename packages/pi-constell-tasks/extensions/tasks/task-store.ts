import { access, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { getWorkspaceTaskRoot, sanitizeWorkspaceId } from './handoff.js'
import type {
  Task,
  TaskCreateParams,
  TaskStoreContext,
  TaskStoreData,
  TasksConfig,
  TaskUpdateParams,
  TaskWarning,
  ResolvedTaskStore,
} from './types.js'

export { getWorkspaceTaskRoot } from './handoff.js'

const DEFAULT_CONFIG: Required<TasksConfig> = {
  taskScope: 'workspace',
  autoCascade: false,
  autoClearCompleted: 'never',
}

const STORE_VERSION = 1 as const
const LOCK_WAIT_MS = 50
const LOCK_RETRIES = 80

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function normalizeTaskList(task: Task): Task {
  return {
    ...task,
    metadata: task.metadata ?? {},
    blocks: [...new Set(task.blocks ?? [])],
    blockedBy: [...new Set(task.blockedBy ?? [])],
    output: [...(task.output ?? [])],
  }
}

export function getWorkspaceTaskConfigPath(workspaceId: string): string {
  return join(getWorkspaceTaskRoot(workspaceId), 'config.json')
}

function sessionStoreFile(rootPath: string, sessionId: string): string {
  const safeSession = sessionId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'session'
  return join(rootPath, `tasks-${safeSession}.json`)
}

function namedStoreFile(rootPath: string, name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'tasks'
  return join(rootPath, `${safeName}.json`)
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function defaultStoreData(): TaskStoreData {
  return {
    schemaVersion: STORE_VERSION,
    nextId: 1,
    tasks: [],
  }
}

function normalizeStoreData(data: TaskStoreData | null | undefined): TaskStoreData {
  if (!data) return defaultStoreData()
  return {
    schemaVersion: STORE_VERSION,
    nextId: Math.max(1, Number(data.nextId ?? 1) || 1),
    tasks: Array.isArray(data.tasks) ? data.tasks.map(normalizeTaskList) : [],
  }
}

export async function loadTasksConfig(context: TaskStoreContext): Promise<Required<TasksConfig>> {
  if (!context.workspaceId) return { ...DEFAULT_CONFIG }
  const configPath = getWorkspaceTaskConfigPath(context.workspaceId)
  try {
    const raw = JSON.parse(await readFile(configPath, 'utf-8')) as TasksConfig
    return {
      taskScope: raw.taskScope ?? DEFAULT_CONFIG.taskScope,
      autoCascade: raw.autoCascade ?? DEFAULT_CONFIG.autoCascade,
      autoClearCompleted: raw.autoClearCompleted ?? DEFAULT_CONFIG.autoClearCompleted,
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export async function saveTasksConfig(context: TaskStoreContext, patch: TasksConfig): Promise<Required<TasksConfig>> {
  if (!context.workspaceId) throw new Error('Task settings require AGENT_ORCH_WS_ID.')
  const configPath = getWorkspaceTaskConfigPath(context.workspaceId)
  const current = await loadTasksConfig(context)
  const next = {
    taskScope: patch.taskScope ?? current.taskScope,
    autoCascade: patch.autoCascade ?? current.autoCascade,
    autoClearCompleted: patch.autoClearCompleted ?? current.autoClearCompleted,
  }
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
  return next
}

export async function resolveTaskStore(context: TaskStoreContext): Promise<ResolvedTaskStore> {
  const rawEnv = process.env.PI_TASKS?.trim().toLowerCase()
  const env = rawEnv && rawEnv !== 'undefined' && rawEnv !== 'null' ? rawEnv : undefined
  const memoryKey = `memory:${sanitizeWorkspaceId(context.workspaceId ?? 'workspace')}:${context.sessionId}`
  if (!context.workspaceId) {
    if (env === 'off' || env === 'memory') {
      return { mode: 'memory', memoryKey, filePath: null, lockPath: null, configPath: null, rootPath: null }
    }
    throw new Error('Task features require AGENT_ORCH_WS_ID so workspace task files stay scoped to ~/.pi/<workspaceId>/tasks/.')
  }

  const rootPath = getWorkspaceTaskRoot(context.workspaceId)
  const configPath = getWorkspaceTaskConfigPath(context.workspaceId)
  const config = await loadTasksConfig(context)
  if (env === 'off' || env === 'memory' || (!env && config.taskScope === 'memory')) {
    return { mode: 'memory', memoryKey, filePath: null, lockPath: null, configPath, rootPath }
  }

  let filePath: string
  if (env === 'session' || (!env && config.taskScope === 'session')) {
    filePath = sessionStoreFile(rootPath, context.sessionId)
  } else if (env && env !== 'workspace' && env !== 'project') {
    filePath = namedStoreFile(rootPath, env)
  } else {
    filePath = join(rootPath, 'tasks.json')
  }

  return {
    mode: 'file',
    memoryKey: null,
    filePath,
    lockPath: `${filePath}.lock`,
    configPath,
    rootPath,
  }
}

function ensureInsideRoot(rootPath: string, targetPath: string): string {
  const resolvedRoot = resolve(rootPath)
  const resolvedTarget = resolve(targetPath)
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}/`)) {
    throw new Error(`Refusing to use task path outside workspace task root: ${resolvedTarget}`)
  }
  return resolvedTarget
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      await mkdir(dirname(lockPath), { recursive: true })
      const handle = await open(lockPath, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }))
      await handle.close()
      return async () => {
        await rm(lockPath, { force: true }).catch(() => {})
      }
    } catch {
      try {
        const raw = JSON.parse(await readFile(lockPath, 'utf-8')) as { pid?: number }
        if (!raw.pid || !isProcessAlive(raw.pid)) {
          await rm(lockPath, { force: true }).catch(() => {})
          continue
        }
      } catch {
        await rm(lockPath, { force: true }).catch(() => {})
        continue
      }
      await sleep(LOCK_WAIT_MS)
    }
  }
  throw new Error(`Timed out waiting for task store lock: ${basename(lockPath)}`)
}

function mergeMetadata(current: Record<string, unknown>, patch: Record<string, unknown | null> | undefined): Record<string, unknown> {
  if (!patch) return { ...current }
  const next = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next
}

function taskById(data: TaskStoreData, taskId: string): Task | undefined {
  return data.tasks.find((task) => task.id === taskId)
}

function hasPath(fromId: string, targetId: string, data: TaskStoreData, seen = new Set<string>()): boolean {
  if (fromId === targetId) return true
  if (seen.has(fromId)) return false
  seen.add(fromId)
  const task = taskById(data, fromId)
  if (!task) return false
  return task.blocks.some((blocked) => hasPath(blocked, targetId, data, seen))
}

function connectEdge(data: TaskStoreData, sourceId: string, targetId: string, warnings: TaskWarning[]): void {
  if (sourceId === targetId) {
    warnings.push({ type: 'self', message: `Task #${sourceId} cannot depend on itself.` })
    return
  }
  const source = taskById(data, sourceId)
  const target = taskById(data, targetId)
  if (!source || !target) {
    warnings.push({ type: 'missing', message: `Task link skipped because #${sourceId} or #${targetId} does not exist.` })
    return
  }
  if (hasPath(targetId, sourceId, data)) {
    warnings.push({ type: 'cycle', message: `Task link #${sourceId} -> #${targetId} would create a cycle and was skipped.` })
    return
  }
  source.blocks = [...new Set([...source.blocks, targetId])]
  target.blockedBy = [...new Set([...target.blockedBy, sourceId])]
}

function detachTask(data: TaskStoreData, taskId: string): void {
  for (const task of data.tasks) {
    task.blocks = task.blocks.filter((id) => id !== taskId)
    task.blockedBy = task.blockedBy.filter((id) => id !== taskId)
  }
}

export function getOpenBlockers(task: Task, data: TaskStoreData): Task[] {
  return task.blockedBy
    .map((taskId) => taskById(data, taskId))
    .filter((candidate): candidate is Task => {
      if (!candidate) return false
      return !['completed', 'cancelled'].includes(candidate.status)
    })
}

export class TaskStore {
  private static readonly memoryDataByKey = new Map<string, TaskStoreData>()

  constructor(private readonly resolved: ResolvedTaskStore) {}

  private async readData(): Promise<TaskStoreData> {
    if (this.resolved.mode === 'memory') {
      return normalizeStoreData(TaskStore.memoryDataByKey.get(this.resolved.memoryKey ?? 'memory:default'))
    }
    if (!this.resolved.filePath) return defaultStoreData()
    if (!(await fileExists(this.resolved.filePath))) return defaultStoreData()
    const raw = JSON.parse(await readFile(this.resolved.filePath, 'utf-8')) as TaskStoreData
    return normalizeStoreData(raw)
  }

  private async writeData(data: TaskStoreData): Promise<void> {
    if (this.resolved.mode === 'memory') {
      TaskStore.memoryDataByKey.set(this.resolved.memoryKey ?? 'memory:default', normalizeStoreData(data))
      return
    }
    if (!this.resolved.filePath || !this.resolved.rootPath || !this.resolved.lockPath) {
      throw new Error('Task store is not writable.')
    }
    ensureInsideRoot(this.resolved.rootPath, this.resolved.filePath)
    const release = await acquireLock(this.resolved.lockPath)
    try {
      await mkdir(dirname(this.resolved.filePath), { recursive: true })
      const tmpPath = `${this.resolved.filePath}.${process.pid}.tmp`
      await writeFile(tmpPath, `${JSON.stringify(normalizeStoreData(data), null, 2)}\n`, 'utf-8')
      await rename(tmpPath, this.resolved.filePath)
    } finally {
      await release()
    }
  }

  private async mutate<T>(mutator: (data: TaskStoreData) => T | Promise<T>): Promise<T> {
    const data = await this.readData()
    const result = await mutator(data)
    await this.writeData(data)
    return result
  }

  async list(): Promise<Task[]> {
    const data = await this.readData()
    return [...data.tasks].sort((left, right) => {
      const order = { pending: 0, in_progress: 1, completed: 2, cancelled: 3 } satisfies Record<Task['status'], number>
      return order[left.status] - order[right.status] || Number(left.id) - Number(right.id)
    })
  }

  async readStore(): Promise<TaskStoreData> {
    return this.readData()
  }

  async get(taskId: string): Promise<Task | undefined> {
    const data = await this.readData()
    return taskById(data, taskId)
  }

  async create(params: TaskCreateParams): Promise<Task> {
    return this.mutate((data) => {
      const now = Date.now()
      const task: Task = {
        id: String(data.nextId++),
        subject: params.subject.trim(),
        description: params.description.trim(),
        status: 'pending',
        activeForm: params.activeForm?.trim() || undefined,
        metadata: {
          ...(params.metadata ?? {}),
          ...(params.agentType ? { agentType: params.agentType } : {}),
        },
        blocks: [],
        blockedBy: [],
        output: [],
        createdAt: now,
        updatedAt: now,
      }
      data.tasks.push(task)
      return task
    })
  }

  async update(params: TaskUpdateParams): Promise<{ task: Task | null; warnings: TaskWarning[] }> {
    return this.mutate((data) => {
      const warnings: TaskWarning[] = []
      const task = taskById(data, params.taskId)
      if (!task) throw new Error(`Task #${params.taskId} does not exist.`)
      if (params.status === 'deleted') {
        detachTask(data, task.id)
        data.tasks = data.tasks.filter((candidate) => candidate.id !== task.id)
        return { task: null, warnings }
      }

      if (params.subject !== undefined) task.subject = params.subject.trim()
      if (params.description !== undefined) task.description = params.description.trim()
      if (params.activeForm !== undefined) task.activeForm = params.activeForm.trim() || undefined
      if (params.owner !== undefined) task.owner = params.owner.trim() || undefined
      task.metadata = mergeMetadata(task.metadata, params.metadata)

      if (params.status !== undefined) {
        task.status = params.status
        if (params.status === 'in_progress') task.startedAt = task.startedAt ?? Date.now()
        if (params.status === 'completed') task.completedAt = Date.now()
        if (params.status === 'cancelled') task.stoppedAt = Date.now()
      }

      for (const targetId of params.addBlocks ?? []) connectEdge(data, task.id, targetId, warnings)
      for (const sourceId of params.addBlockedBy ?? []) connectEdge(data, sourceId, task.id, warnings)

      task.updatedAt = Date.now()
      return { task, warnings }
    })
  }

  async replaceTask(task: Task): Promise<void> {
    await this.mutate((data) => {
      const index = data.tasks.findIndex((candidate) => candidate.id === task.id)
      if (index === -1) throw new Error(`Task #${task.id} does not exist.`)
      data.tasks[index] = normalizeTaskList({ ...task, updatedAt: Date.now() })
    })
  }

  async appendOutput(taskId: string, chunk: string): Promise<Task> {
    return this.mutate((data) => {
      const task = taskById(data, taskId)
      if (!task) throw new Error(`Task #${taskId} does not exist.`)
      task.output.push(chunk)
      task.updatedAt = Date.now()
      return task
    })
  }

  async clearCompleted(taskIds?: string[]): Promise<number> {
    return this.mutate((data) => {
      const requestedIds = taskIds ? new Set(taskIds) : null
      const completedIds = new Set(
        data.tasks
          .filter((task) => ['completed', 'cancelled'].includes(task.status))
          .filter((task) => !requestedIds || requestedIds.has(task.id))
          .map((task) => task.id),
      )
      if (!completedIds.size) return 0
      data.tasks = data.tasks.filter((task) => !completedIds.has(task.id))
      for (const task of data.tasks) {
        task.blocks = task.blocks.filter((id) => !completedIds.has(id))
        task.blockedBy = task.blockedBy.filter((id) => !completedIds.has(id))
      }
      return completedIds.size
    })
  }

  async clearAll(): Promise<void> {
    if (this.resolved.mode === 'memory') {
      TaskStore.memoryDataByKey.delete(this.resolved.memoryKey ?? 'memory:default')
      return
    }
    if (this.resolved.filePath) await rm(this.resolved.filePath, { force: true }).catch(() => {})
    if (this.resolved.lockPath) await rm(this.resolved.lockPath, { force: true }).catch(() => {})
  }
}

export async function removeWorkspaceTaskRoot(workspaceId: string): Promise<void> {
  const rootPath = getWorkspaceTaskRoot(workspaceId)
  await rm(rootPath, { recursive: true, force: true }).catch(() => {})
}
