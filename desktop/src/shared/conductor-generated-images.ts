import {
  CONDUCTOR_MAX_IMAGE_BYTES,
  inferConductorImageMimeType,
  isSupportedConductorImageMimeType,
  type ConductorImageMimeType,
} from './conductor-attachments'

export const CONDUCTOR_GENERATED_IMAGES_KIND = 'generatedImages'
export const CONDUCTOR_GENERATED_IMAGE_KIND = 'generatedImage'

export type ConductorGeneratedImageProvider = 'codex' | 'cursor'

export interface ConductorGeneratedImage {
  readonly kind: typeof CONDUCTOR_GENERATED_IMAGE_KIND
  readonly id: string
  readonly mimeType: ConductorImageMimeType
  readonly data: string
  readonly name?: string
  readonly filePath?: string
  readonly prompt?: string
  readonly provider?: ConductorGeneratedImageProvider
}

export interface ConductorGeneratedImageOutput {
  readonly kind: typeof CONDUCTOR_GENERATED_IMAGES_KIND
  readonly images: readonly ConductorGeneratedImage[]
}

export interface ConductorGeneratedImageExtractionOptions {
  readonly toolName?: string
  readonly input?: unknown
  readonly provider?: ConductorGeneratedImageProvider
}

interface ImageCandidate {
  readonly data: string
  readonly mimeType?: string
  readonly filePath?: string
  readonly name?: string
  readonly prompt?: string
}

const MAX_EXTRACTED_IMAGES = 8
const MAX_RECURSION_DEPTH = 7
const IMAGE_DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

const IMAGE_TOOL_NAMES = new Set([
  'generateimage',
  'generate_image',
  'imagegen',
  'image_gen',
  'imagegeneration',
  'image_generation',
  'openai.image_generation',
  'openai.generate_image',
])

export function isConductorGeneratedImageToolName(toolName: string): boolean {
  const normalized = normalizeToolName(toolName)
  if (IMAGE_TOOL_NAMES.has(normalized)) return true
  return /(^|[._-])(generate[-_]?image|image[-_]?gen|image[-_]?generation)$/i.test(toolName)
}

export function isConductorGeneratedImageOutput(
  value: unknown,
): value is ConductorGeneratedImageOutput {
  return normalizeConductorGeneratedImageOutput(value) !== undefined
}

export function normalizeConductorGeneratedImageOutput(
  value: unknown,
): ConductorGeneratedImageOutput | undefined {
  if (!isRecord(value) || value.kind !== CONDUCTOR_GENERATED_IMAGES_KIND || !Array.isArray(value.images)) {
    return undefined
  }
  const images = value.images.flatMap((image, index) => normalizeGeneratedImage(image, index))
  return images.length > 0 ? { kind: CONDUCTOR_GENERATED_IMAGES_KIND, images } : undefined
}

export function extractConductorGeneratedImages(
  value: unknown,
  options: ConductorGeneratedImageExtractionOptions = {},
): ConductorGeneratedImageOutput | undefined {
  const normalized = normalizeConductorGeneratedImageOutput(value)
  if (normalized) return normalized

  const context = contextFromInput(options.input)
  const candidates: ImageCandidate[] = []
  collectImageCandidates(value, context, candidates, 0, new Set())
  if (candidates.length === 0) return undefined

  const seen = new Set<string>()
  const images: ConductorGeneratedImage[] = []
  for (const candidate of candidates) {
    if (images.length >= MAX_EXTRACTED_IMAGES) break
    const image = imageFromCandidate(candidate, images.length, options)
    if (!image) continue
    const key = `${image.mimeType}:${image.data}`
    if (seen.has(key)) continue
    seen.add(key)
    images.push(image)
  }

  return images.length > 0 ? { kind: CONDUCTOR_GENERATED_IMAGES_KIND, images } : undefined
}

function normalizeGeneratedImage(value: unknown, index: number): ConductorGeneratedImage[] {
  if (!isRecord(value) || value.kind !== CONDUCTOR_GENERATED_IMAGE_KIND) return []
  const image = imageFromCandidate(
    {
      data: stringValue(value.data) ?? '',
      mimeType: stringValue(value.mimeType),
      filePath: stringValue(value.filePath),
      name: stringValue(value.name),
      prompt: stringValue(value.prompt),
    },
    index,
    { provider: providerValue(value.provider) },
  )
  return image ? [image] : []
}

function collectImageCandidates(
  value: unknown,
  context: ImageCandidate,
  candidates: ImageCandidate[],
  depth: number,
  visited: Set<object>,
): void {
  if (candidates.length >= MAX_EXTRACTED_IMAGES || depth > MAX_RECURSION_DEPTH) return

  if (typeof value === 'string') {
    const dataUrl = parseImageData(value)
    if (dataUrl) {
      candidates.push({ ...context, ...dataUrl })
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectImageCandidates(item, context, candidates, depth + 1, visited)
      if (candidates.length >= MAX_EXTRACTED_IMAGES) return
    }
    return
  }

  if (!isRecord(value)) return
  if (visited.has(value)) return
  visited.add(value)

  const nextContext = mergeContext(context, value)
  const direct = directCandidate(value, nextContext)
  if (direct) {
    candidates.push(direct)
    if (candidates.length >= MAX_EXTRACTED_IMAGES) return
  }

  const preferredKeys = ['result', 'value', 'content', 'structured_content', 'structuredContent', 'output', 'data', 'image']
  for (const key of preferredKeys) {
    if (key in value) {
      collectImageCandidates(value[key], nextContext, candidates, depth + 1, visited)
      if (candidates.length >= MAX_EXTRACTED_IMAGES) return
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (preferredKeys.includes(key)) continue
    if (!mayContainImage(key, child)) continue
    collectImageCandidates(child, nextContext, candidates, depth + 1, visited)
    if (candidates.length >= MAX_EXTRACTED_IMAGES) return
  }
}

function directCandidate(value: Record<string, unknown>, context: ImageCandidate): ImageCandidate | undefined {
  const imageData = firstString(value.imageData, value.b64_json, value.base64, value.data)
  const nestedImage = isRecord(value.image) ? value.image : undefined
  const nestedImageData = nestedImage ? firstString(nestedImage.data, nestedImage.imageData, nestedImage.b64_json) : undefined
  const rawData = imageData ?? nestedImageData
  if (!rawData) return undefined

  const parsed = parseImageData(rawData)
  const mimeType =
    parsed?.mimeType ??
    firstString(value.mimeType, value.mediaType, value.type, nestedImage?.mimeType, nestedImage?.mediaType) ??
    context.mimeType
  return {
    ...context,
    data: parsed?.data ?? rawData,
    mimeType,
    filePath: firstString(value.filePath, value.path, nestedImage?.filePath, nestedImage?.path) ?? context.filePath,
    name: firstString(value.name, value.filename, value.fileName, nestedImage?.name) ?? context.name,
    prompt: firstString(value.prompt, value.description, value.revised_prompt, value.revisedPrompt) ?? context.prompt,
  }
}

function imageFromCandidate(
  candidate: ImageCandidate,
  index: number,
  options: ConductorGeneratedImageExtractionOptions,
): ConductorGeneratedImage | undefined {
  const parsed = parseImageData(candidate.data)
  const data = normalizeBase64Data(parsed?.data ?? candidate.data)
  if (!data || !isDecodedImageSizeAllowed(data)) return undefined

  const mimeType = imageMimeType(parsed?.mimeType ?? candidate.mimeType, candidate.filePath ?? candidate.name, options.toolName)
  if (!mimeType) return undefined

  const filePath = cleanString(candidate.filePath)
  const name = cleanString(candidate.name) ?? fileNameFromPath(filePath)
  const prompt = cleanString(candidate.prompt)
  const id = `generated-image-${hashString(`${mimeType}:${data}:${index}`)}`
  return {
    kind: CONDUCTOR_GENERATED_IMAGE_KIND,
    id,
    mimeType,
    data,
    ...(name ? { name } : {}),
    ...(filePath ? { filePath } : {}),
    ...(prompt ? { prompt } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
  }
}

function contextFromInput(input: unknown): ImageCandidate {
  if (!isRecord(input)) return { data: '' }
  return mergeContext({ data: '' }, input)
}

function mergeContext(context: ImageCandidate, value: Record<string, unknown>): ImageCandidate {
  return {
    ...context,
    mimeType: firstString(value.mimeType, value.mediaType, value.type) ?? context.mimeType,
    filePath: firstString(value.filePath, value.path) ?? context.filePath,
    name: firstString(value.name, value.filename, value.fileName) ?? context.name,
    prompt:
      firstString(value.prompt, value.description, value.revised_prompt, value.revisedPrompt, value.query) ??
      context.prompt,
  }
}

function imageMimeType(
  rawMimeType: string | undefined,
  fileName: string | undefined,
  toolName: string | undefined,
): ConductorImageMimeType | undefined {
  if (rawMimeType && isSupportedConductorImageMimeType(rawMimeType)) return rawMimeType
  const inferred = inferConductorImageMimeType(fileName ?? '', rawMimeType)
  if (inferred) return inferred
  if (rawMimeType) return undefined
  return toolName && isConductorGeneratedImageToolName(toolName) ? 'image/png' : undefined
}

function parseImageData(value: string): { mimeType: string; data: string } | undefined {
  const match = value.trim().match(IMAGE_DATA_URL_RE)
  if (!match) return undefined
  return { mimeType: match[1] ?? '', data: match[2] ?? '' }
}

function normalizeBase64Data(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!normalized || normalized.length % 4 === 1 || !BASE64_RE.test(normalized)) return undefined
  return normalized
}

function isDecodedImageSizeAllowed(data: string): boolean {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  const decodedBytes = Math.floor((data.length * 3) / 4) - padding
  return decodedBytes > 0 && decodedBytes <= CONDUCTOR_MAX_IMAGE_BYTES
}

function mayContainImage(key: string, value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return key.toLowerCase().includes('image') || key === 'data' || key === 'b64_json'
  return typeof value === 'object'
}

function providerValue(value: unknown): ConductorGeneratedImageProvider | undefined {
  return value === 'codex' || value === 'cursor' ? value : undefined
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value)
    if (text) return text
  }
  return undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function fileNameFromPath(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined
  return filePath.split(/[\\/]/).pop() || undefined
}

function normalizeToolName(toolName: string): string {
  return toolName.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
