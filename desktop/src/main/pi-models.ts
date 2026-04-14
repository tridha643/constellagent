import { execFile } from 'child_process'
import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { promisify } from 'util'
import type { PiModelOption } from '../shared/plan-build-command'
import {
  parsePiListModelsOrThrow,
  resolvePiModelList,
  type PiModelCacheRecord,
} from '../shared/pi-models'

const execFileAsync = promisify(execFile)
const PI_MODEL_TIMEOUT_MS = 10_000
const PI_MODEL_MAX_BUFFER = 1024 * 1024

function piModelCacheFilePath(): string {
  return join(app.getPath('userData'), 'pi-models-cache.json')
}

async function readPiModelCache(cacheFilePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(cacheFilePath, 'utf-8')) as PiModelCacheRecord
  } catch {
    return null
  }
}

async function writePiModelCache(cacheFilePath: string, record: PiModelCacheRecord): Promise<void> {
  await mkdir(dirname(cacheFilePath), { recursive: true })
  await writeFile(cacheFilePath, JSON.stringify(record, null, 2), 'utf-8')
}

async function listPiModelsFromCli(): Promise<PiModelOption[]> {
  const forcedError = process.env.CONSTELLAGENT_PI_MODELS_ERROR?.trim()
  if (forcedError) throw new Error(forcedError)

  const fixtureStdout = process.env.CONSTELLAGENT_PI_MODELS_STDOUT
  const fixtureStderr = process.env.CONSTELLAGENT_PI_MODELS_STDERR
  if (fixtureStdout || fixtureStderr) {
    return parsePiListModelsOrThrow([fixtureStdout, fixtureStderr].filter(Boolean).join('\n'))
  }

  const { stdout, stderr } = await execFileAsync('pi', ['--list-models'], {
    timeout: PI_MODEL_TIMEOUT_MS,
    maxBuffer: PI_MODEL_MAX_BUFFER,
  })

  return parsePiListModelsOrThrow([stdout, stderr].filter(Boolean).join('\n'))
}

export async function listPiModels(): Promise<PiModelOption[]> {
  const cacheFilePath = piModelCacheFilePath()
  return resolvePiModelList({
    readCache: () => readPiModelCache(cacheFilePath),
    writeCache: (record) => writePiModelCache(cacheFilePath, record),
    fetchRuntimeModels: listPiModelsFromCli,
  })
}
