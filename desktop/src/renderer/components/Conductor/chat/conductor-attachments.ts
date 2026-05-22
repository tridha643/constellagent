/// <reference lib="dom" />

import {
  SUPPORTED_CONDUCTOR_IMAGE_TYPES,
  type ConductorComposerAttachment,
  type ConductorImageAttachment,
  type ConductorImageMimeType,
} from '../../../../shared/conductor-attachments'

type FileWithPath = File & { readonly path?: string }

const SUPPORTED_CONDUCTOR_IMAGE_MIME_TYPES = new Set(
  SUPPORTED_CONDUCTOR_IMAGE_TYPES.map((type) => type.mimeType),
)
const IMAGE_MIME_TYPE_BY_EXTENSION = new Map(
  SUPPORTED_CONDUCTOR_IMAGE_TYPES.map((type) => [type.extension, type.mimeType] as const),
)

export const CONDUCTOR_IMAGE_ACCEPT = SUPPORTED_CONDUCTOR_IMAGE_TYPES
  .map((type) => type.mimeType)
  .join(',')

function inferImageMimeType(file: Pick<File, 'name' | 'type'>): ConductorImageMimeType | undefined {
  if (SUPPORTED_CONDUCTOR_IMAGE_MIME_TYPES.has(file.type as ConductorImageMimeType)) {
    return file.type as ConductorImageMimeType
  }

  const extension = file.name.split('.').pop()?.trim().toLowerCase()
  if (!extension) return undefined
  return IMAGE_MIME_TYPE_BY_EXTENSION.get(
    extension as (typeof SUPPORTED_CONDUCTOR_IMAGE_TYPES)[number]['extension'],
  )
}

function isImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  return Boolean(inferImageMimeType(file))
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

  const itemFiles = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
    .filter(isImageFile)
  const clipboardFiles = Array.from(clipboardData.files ?? []).filter(isImageFile)
  return dedupeFiles([...itemFiles, ...clipboardFiles])
}

export function extractImageFilesFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined,
): File[] {
  if (!dataTransfer) return []

  const itemFiles = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
    .filter(isImageFile)
  const transferFiles = Array.from(dataTransfer.files ?? []).filter(isImageFile)
  return dedupeFiles([...itemFiles, ...transferFiles])
}

export async function readConductorImageAttachmentsFromFiles(
  files: readonly File[],
): Promise<ConductorComposerAttachment[]> {
  const attachments = await Promise.all(dedupeFiles(files).map(readImageAttachmentFromFile))
  return attachments.filter((attachment): attachment is ConductorImageAttachment => Boolean(attachment))
}

function readImageAttachmentFromFile(file: File): Promise<ConductorImageAttachment | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const commaIndex = dataUrl.indexOf(',')
      resolve({
        id: crypto.randomUUID(),
        kind: 'image',
        name: file.name || 'pasted-image.png',
        mimeType: inferImageMimeType(file) ?? 'image/png',
        data: dataUrl.slice(commaIndex + 1),
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
