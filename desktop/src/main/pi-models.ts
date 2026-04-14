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
import { cliEnvWithStandardPath } from './cli-env'

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

  // `pi --list-models` writes the table to stderr when stdout is not a TTY. Under Electron,
  // relying on execFile's stderr capture has proven flaky; merge streams via the shell.
  const env = cliEnvWithStandardPath()
  const opts = {
    env,
    timeout: PI_MODEL_TIMEOUT_MS,
    maxBuffer: PI_MODEL_MAX_BUFFER,
    encoding: 'utf8' as const,
  }
  const merged =
    process.platform === 'win32'
      ? (await execFileAsync('cmd.exe', ['/d', '/s', '/c', 'pi --list-models 2>&1'], opts)).stdout
      : (await execFileAsync('/bin/sh', ['-c', 'pi --list-models 2>&1'], opts)).stdout

  return parsePiListModelsOrThrow(merged)
}

export async function listPiModels(): Promise<PiModelOption[]> {
  const cacheFilePath = piModelCacheFilePath()
  return resolvePiModelList({
    readCache: () => readPiModelCache(cacheFilePath),
    writeCache: (record) => writePiModelCache(cacheFilePath, record),
    fetchRuntimeModels: listPiModelsFromCli,
  })
}
