export const CONDUCTOR_IMAGE_ONLY_PROMPT =
  'Please inspect the attached image and respond to it.'

/** Max decoded image size accepted by Conductor attach (20 MiB). */
export const CONDUCTOR_MAX_IMAGE_BYTES = 20 * 1024 * 1024

export const SUPPORTED_CONDUCTOR_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const

export const SUPPORTED_CONDUCTOR_IMAGE_TYPES = [
  { extension: 'png', mimeType: 'image/png' },
  { extension: 'jpg', mimeType: 'image/jpeg' },
  { extension: 'jpeg', mimeType: 'image/jpeg' },
  { extension: 'gif', mimeType: 'image/gif' },
  { extension: 'webp', mimeType: 'image/webp' },
] as const

export type ConductorImageMimeType =
  (typeof SUPPORTED_CONDUCTOR_IMAGE_TYPES)[number]['mimeType']

export interface ConductorImageAttachment {
  readonly id: string
  readonly kind: 'image'
  readonly name: string
  readonly mimeType: ConductorImageMimeType
  readonly data: string
}

export type ConductorComposerAttachment = ConductorImageAttachment

const SUPPORTED_CONDUCTOR_IMAGE_MIME_TYPES = new Set(
  SUPPORTED_CONDUCTOR_IMAGE_TYPES.map((type) => type.mimeType),
)

const CONDUCTOR_IMAGE_MIME_TYPE_BY_EXTENSION = new Map(
  SUPPORTED_CONDUCTOR_IMAGE_TYPES.map((type) => [type.extension, type.mimeType] as const),
)

export function inferConductorImageMimeType(
  fileName: string,
  mimeType?: string,
): ConductorImageMimeType | undefined {
  if (mimeType && isSupportedConductorImageMimeType(mimeType)) {
    return mimeType
  }

  const extension = fileName.split('.').pop()?.trim().toLowerCase()
  if (!extension) return undefined
  return CONDUCTOR_IMAGE_MIME_TYPE_BY_EXTENSION.get(
    extension as (typeof SUPPORTED_CONDUCTOR_IMAGE_TYPES)[number]['extension'],
  )
}

export function formatConductorImageSizeLimit(): string {
  return `${Math.round(CONDUCTOR_MAX_IMAGE_BYTES / (1024 * 1024))} MB`
}

export function isSupportedConductorImageMimeType(
  value: unknown,
): value is ConductorImageMimeType {
  return (
    typeof value === 'string' &&
    SUPPORTED_CONDUCTOR_IMAGE_MIME_TYPES.has(value as ConductorImageMimeType)
  )
}

export function normalizeConductorImageAttachments(
  attachments: readonly ConductorComposerAttachment[] | undefined,
): ConductorImageAttachment[] {
  if (!Array.isArray(attachments)) return []
  return attachments.filter((attachment): attachment is ConductorImageAttachment => {
    if (!attachment || typeof attachment !== 'object') return false
    return (
      attachment.kind === 'image' &&
      typeof attachment.id === 'string' &&
      typeof attachment.name === 'string' &&
      isSupportedConductorImageMimeType(attachment.mimeType) &&
      typeof attachment.data === 'string' &&
      attachment.data.trim().length > 0
    )
  })
}

export function cloneConductorImageAttachments(
  attachments: readonly ConductorComposerAttachment[] | undefined,
): ConductorImageAttachment[] {
  return normalizeConductorImageAttachments(attachments).map((attachment) => ({
    ...attachment,
  }))
}

export function hasConductorMessageInput(
  text: string,
  attachments: readonly ConductorComposerAttachment[] | undefined,
): boolean {
  return text.trim().length > 0 || normalizeConductorImageAttachments(attachments).length > 0
}

export function conductorPromptText(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : CONDUCTOR_IMAGE_ONLY_PROMPT
}
