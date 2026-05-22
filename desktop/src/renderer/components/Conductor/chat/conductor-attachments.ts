/// <reference lib="dom" />

import {
  CONDUCTOR_MAX_IMAGE_BYTES,
  formatConductorImageSizeLimit,
  inferConductorImageMimeType,
  SUPPORTED_CONDUCTOR_IMAGE_TYPES,
  type ConductorComposerAttachment,
  type ConductorImageAttachment,
  type ConductorImageMimeType,
} from '../../../../shared/conductor-attachments'

type FileWithPath = File & { readonly path?: string }

export interface ReadConductorImageAttachmentsResult {
  readonly attachments: ConductorImageAttachment[]
  readonly rejectedCount: number
  readonly error?: string
}

export const CONDUCTOR_IMAGE_ACCEPT = [
  ...SUPPORTED_CONDUCTOR_IMAGE_TYPES.map((type) => type.mimeType),
  ...SUPPORTED_CONDUCTOR_IMAGE_TYPES.map((type) => `.${type.extension}`),
].join(',')

function inferImageMimeType(
  file: Pick<File, 'name' | 'type'>,
  itemType?: string,
): ConductorImageMimeType | undefined {
  if (itemType) {
    const fromItem = inferConductorImageMimeType('image.png', itemType)
    if (fromItem) return fromItem
  }
  return inferConductorImageMimeType(file.name, file.type || undefined)
}

function isImageFile(file: Pick<File, 'name' | 'type'>, itemType?: string): boolean {
  return Boolean(inferImageMimeType(file, itemType))
}

function fileSignature(file: FileWithPath): string {
  return `${file.path ?? ''}:${file.name}:${file.type}:${file.size}:${file.lastModified}`
}

function dedupeFiles(files: readonly File[]): File[] {
  const seen = new Set<string>()
  const unique: File[] = []
  for (const file of files) {
    const signature = fileSignature(file as FileWithPath)
    if (seen.has(signature)) continue
    seen.add(signature)
    unique.push(file)
  }
  return unique
}

export function hasFilesInDataTransfer(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false
  const types = Array.from(dataTransfer.types ?? [])
  if (types.includes('Files')) return true
  if (Array.from(dataTransfer.items ?? []).some((item) => item.kind === 'file')) return true
  return (dataTransfer.files?.length ?? 0) > 0
}

export function extractImageFilesFromClipboardData(
  clipboardData: DataTransfer | null | undefined,
): File[] {
  if (!clipboardData) return []

  const fromItems = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => {
      const file = item.getAsFile()
      if (!file || !isImageFile(file, item.type)) return null
      return file
    })
    .filter((file): file is File => Boolean(file))

  const fromFiles = Array.from(clipboardData.files ?? []).filter((file) => isImageFile(file))
  return dedupeFiles([...fromItems, ...fromFiles])
}

export function extractImageFilesFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined,
): File[] {
  if (!dataTransfer) return []

  const itemFiles = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => {
      const file = item.getAsFile()
      if (!file || !isImageFile(file, item.type)) return null
      return file
    })
    .filter((file): file is File => Boolean(file))
  const transferFiles = Array.from(dataTransfer.files ?? []).filter((file) => isImageFile(file))
  return dedupeFiles([...itemFiles, ...transferFiles])
}

export async function readConductorImageAttachmentsFromFiles(
  files: readonly File[],
): Promise<ReadConductorImageAttachmentsResult> {
  const unique = dedupeFiles(files)
  const attachments: ConductorImageAttachment[] = []
  let rejectedCount = 0
  let oversize = false
  let unsupported = false
  let readFailed = false

  for (const file of unique) {
    const mimeType = inferImageMimeType(file)
    if (!mimeType) {
      unsupported = true
      rejectedCount += 1
      continue
    }

    if (file.size > CONDUCTOR_MAX_IMAGE_BYTES) {
      oversize = true
      rejectedCount += 1
      continue
    }

    const attachment = await readImageAttachmentFromFile(file, mimeType)
    if (!attachment) {
      readFailed = true
      rejectedCount += 1
      continue
    }

    attachments.push(attachment)
  }

  let error: string | undefined
  if (rejectedCount > 0 && attachments.length === 0) {
    if (readFailed) {
      error = 'Could not read the selected image.'
    } else if (oversize && unsupported) {
      error = `Could not attach ${rejectedCount} file(s). Use PNG, JPEG, GIF, or WebP under ${formatConductorImageSizeLimit()}.`
    } else if (oversize) {
      error = `Image exceeds ${formatConductorImageSizeLimit()} limit.`
    } else {
      error = 'Unsupported image format. Use PNG, JPEG, GIF, or WebP.'
    }
  } else if (rejectedCount > 0) {
    error = `${rejectedCount} file(s) skipped (unsupported format or over ${formatConductorImageSizeLimit()}).`
  }

  return { attachments, rejectedCount, error }
}

function readImageAttachmentFromFile(
  file: File,
  mimeType: ConductorImageMimeType,
): Promise<ConductorImageAttachment | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const commaIndex = dataUrl.indexOf(',')
      if (commaIndex < 0) {
        resolve(null)
        return
      }
      const data = dataUrl.slice(commaIndex + 1)
      const decodedBytes = Math.floor((data.length * 3) / 4)
      if (decodedBytes > CONDUCTOR_MAX_IMAGE_BYTES) {
        resolve(null)
        return
      }
      resolve({
        id: crypto.randomUUID(),
        kind: 'image',
        name: file.name || 'pasted-image.png',
        mimeType,
        data,
      })
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

export function mergeConductorAttachments(
  current: readonly ConductorComposerAttachment[],
  incoming: readonly ConductorComposerAttachment[],
): ConductorComposerAttachment[] {
  const seen = new Set(current.map(attachmentSignature))
  const next = [...current]
  for (const attachment of incoming) {
    const signature = attachmentSignature(attachment)
    if (seen.has(signature)) continue
    seen.add(signature)
    next.push(attachment)
  }
  return next
}

function attachmentSignature(attachment: ConductorComposerAttachment): string {
  return `${attachment.kind}:${attachment.name}:${attachment.mimeType}:${attachment.data.length}:${attachment.data.slice(0, 80)}`
}
