import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import {
  CONDUCTOR_MAX_IMAGE_BYTES,
  inferConductorImageMimeType,
  type ConductorImageMimeType,
} from '../shared/conductor-attachments'
import {
  extractConductorGeneratedImages,
  extractImagePathsFromText,
  looksLikeGeneratedImageCompletionText,
  type ConductorGeneratedImage,
  type ConductorGeneratedImageExtractionOptions,
  type ConductorGeneratedImageOutput,
} from '../shared/conductor-generated-images'

export interface ResolveConductorGeneratedImagesOptions extends ConductorGeneratedImageExtractionOptions {
  readonly workspacePath: string
  readonly sinceMs?: number
}

const IMAGE_FILE_NAME_RE = /\.(?:png|jpe?g|gif|webp)$/i

export function resolveCodexHome(): string {
  const fromEnv = process.env.CODEX_HOME?.trim()
  if (fromEnv) return fromEnv.replace(/^~(?=$|[\\/])/, homedir())
  return join(homedir(), '.codex')
}

export async function resolveConductorGeneratedImagesWithFiles(
  output: unknown,
  options: ResolveConductorGeneratedImagesOptions,
): Promise<ConductorGeneratedImageOutput | undefined> {
  const extracted = extractConductorGeneratedImages(output, options)
  if (!extracted) return undefined

  const images = await hydrateGeneratedImages(extracted.images, options.workspacePath)
  return images.length > 0 ? { kind: 'generatedImages', images } : undefined
}

export async function loadGeneratedImagesFromText(
  text: string,
  workspacePath: string,
  options: ConductorGeneratedImageExtractionOptions & { sinceMs?: number } = {},
): Promise<ConductorGeneratedImageOutput | undefined> {
  const paths = extractImagePathsFromText(text)
  const images: ConductorGeneratedImage[] = []
  for (const [index, filePath] of paths.entries()) {
    const loaded = await loadGeneratedImageFromPath(filePath, workspacePath, options, index)
    if (loaded) images.push(loaded)
  }
  if (images.length > 0) {
    return { kind: 'generatedImages', images }
  }

  if (looksLikeGeneratedImageCompletionText(text)) {
    return loadLatestCodexGeneratedImages(options)
  }
  return undefined
}

export async function loadGeneratedImagesForTurn(
  turnText: string,
  workspacePath: string,
  options: ConductorGeneratedImageExtractionOptions & { sinceMs?: number } = {},
): Promise<ConductorGeneratedImageOutput | undefined> {
  const fromText = await loadGeneratedImagesFromText(turnText, workspacePath, options)
  if (fromText) return fromText

  if (looksLikeGeneratedImageCompletionText(turnText)) {
    return loadLatestCodexGeneratedImages(options)
  }
  return undefined
}

export async function loadLatestCodexGeneratedImages(
  options: ConductorGeneratedImageExtractionOptions & { sinceMs?: number; limit?: number } = {},
): Promise<ConductorGeneratedImageOutput | undefined> {
  const files = await findLatestCodexGeneratedImageFiles(options.sinceMs, options.limit ?? 4)
  if (files.length === 0) return undefined

  const images: ConductorGeneratedImage[] = []
  for (const [index, filePath] of files.entries()) {
    const loaded = await loadGeneratedImageFromPath(filePath, '', options, index)
    if (loaded) images.push(loaded)
  }
  return images.length > 0 ? { kind: 'generatedImages', images } : undefined
}

export async function findLatestCodexGeneratedImageFiles(
  sinceMs?: number,
  limit = 4,
): Promise<string[]> {
  const root = join(resolveCodexHome(), 'generated_images')
  if (!existsSync(root)) return []

  const cutoff = sinceMs ?? Date.now() - 10 * 60 * 1000
  const matches: { path: string; mtimeMs: number }[] = []

  await walkGeneratedImageDir(root, async (filePath) => {
    if (!IMAGE_FILE_NAME_RE.test(filePath)) return
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) return
    if (fileStat.mtimeMs < cutoff) return
    matches.push({ path: filePath, mtimeMs: fileStat.mtimeMs })
  })

  matches.sort((left, right) => right.mtimeMs - left.mtimeMs)
  return matches.slice(0, limit).map((entry) => entry.path)
}

async function walkGeneratedImageDir(dir: string, visit: (filePath: string) => Promise<void>): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkGeneratedImageDir(fullPath, visit)
      continue
    }
    if (entry.isFile()) {
      await visit(fullPath)
    }
  }
}

async function hydrateGeneratedImages(
  images: readonly ConductorGeneratedImage[],
  workspacePath: string,
): Promise<ConductorGeneratedImage[]> {
  const out: ConductorGeneratedImage[] = []
  for (const [index, image] of images.entries()) {
    if (image.data) {
      out.push(image)
      continue
    }
    if (!image.filePath) continue
    const loaded = await loadGeneratedImageFromPath(image.filePath, workspacePath, {}, index, image)
    if (loaded) out.push(loaded)
  }
  return out
}

async function loadGeneratedImageFromPath(
  pathRef: string,
  workspacePath: string,
  options: ConductorGeneratedImageExtractionOptions,
  index: number,
  seed?: ConductorGeneratedImage,
): Promise<ConductorGeneratedImage | undefined> {
  const absolutePath = resolveGeneratedImagePath(pathRef, workspacePath)
  if (!absolutePath) return seed

  try {
    const buffer = await readFile(absolutePath)
    if (buffer.byteLength <= 0 || buffer.byteLength > CONDUCTOR_MAX_IMAGE_BYTES) {
      return seed?.filePath ? { ...seed, filePath: absolutePath } : undefined
    }

    const mimeType =
      seed?.mimeType ??
      inferConductorImageMimeType(absolutePath) ??
      inferConductorImageMimeType(pathRef)
    if (!mimeType) return seed?.filePath ? { ...seed, filePath: absolutePath } : undefined

    const data = buffer.toString('base64')
    const name = seed?.name ?? basename(absolutePath)
    return {
      kind: 'generatedImage',
      id: seed?.id ?? `generated-image-${index}-${basename(absolutePath)}`,
      mimeType,
      data,
      name,
      filePath: absolutePath,
      ...(seed?.prompt ? { prompt: seed.prompt } : {}),
      ...(options.provider ? { provider: options.provider } : {}),
      ...(seed?.provider ? { provider: seed.provider } : {}),
    }
  } catch {
    return seed?.filePath ? { ...seed, filePath: absolutePath } : undefined
  }
}

export function resolveGeneratedImagePath(pathRef: string, workspacePath: string): string | undefined {
  const trimmed = pathRef.trim()
  if (!trimmed) return undefined

  const codexGeneratedRoot = join(resolveCodexHome(), 'generated_images')
  const candidates: string[] = []

  if (isAbsolute(trimmed)) {
    candidates.push(trimmed)
  } else {
    if (workspacePath) {
      candidates.push(
        join(workspacePath, trimmed),
        join(workspacePath, basename(trimmed)),
        join(workspacePath, 'assets', basename(trimmed)),
      )
    }
    candidates.push(join(codexGeneratedRoot, trimmed), join(codexGeneratedRoot, basename(trimmed)))
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  if (trimmed.includes('generated_images/')) {
    const suffix = trimmed.split('generated_images/').pop()
    if (suffix) {
      const codexCandidate = join(codexGeneratedRoot, suffix)
      if (existsSync(codexCandidate)) return codexCandidate
    }
  }

  return undefined
}

export function isSupportedGeneratedImageMimeType(value: string | undefined): value is ConductorImageMimeType {
  return inferConductorImageMimeType('placeholder.png', value) !== undefined
}
