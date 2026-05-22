import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { dialog } from 'electron'
import {
  CONDUCTOR_MAX_IMAGE_BYTES,
  formatConductorImageSizeLimit,
  inferConductorImageMimeType,
  type ConductorImageAttachment,
} from '../shared/conductor-attachments'

export interface PickConductorImagesResult {
  readonly attachments: readonly ConductorImageAttachment[]
  readonly error?: string
}

export async function pickConductorImageAttachments(): Promise<PickConductorImagesResult> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    title: 'Attach images',
    filters: [
      {
        name: 'Images',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
      },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { attachments: [] }
  }

  const attachments: ConductorImageAttachment[] = []
  let rejectedCount = 0
  let oversize = false
  let unsupported = false

  for (const filePath of result.filePaths) {
    const name = basename(filePath)
    const mimeType = inferConductorImageMimeType(name)
    if (!mimeType) {
      unsupported = true
      rejectedCount += 1
      continue
    }

    const buffer = await readFile(filePath)
    if (buffer.byteLength > CONDUCTOR_MAX_IMAGE_BYTES) {
      oversize = true
      rejectedCount += 1
      continue
    }

    attachments.push({
      id: randomUUID(),
      kind: 'image',
      name,
      mimeType,
      data: buffer.toString('base64'),
    })
  }

  let error: string | undefined
  if (rejectedCount > 0 && attachments.length === 0) {
    if (oversize && unsupported) {
      error = `Could not attach ${rejectedCount} file(s). Use PNG, JPEG, GIF, or WebP under ${formatConductorImageSizeLimit()}.`
    } else if (oversize) {
      error = `Image exceeds ${formatConductorImageSizeLimit()} limit.`
    } else {
      error = 'Unsupported image format. Use PNG, JPEG, GIF, or WebP.'
    }
  } else if (rejectedCount > 0) {
    error = `${rejectedCount} file(s) skipped (unsupported format or over ${formatConductorImageSizeLimit()}).`
  }

  return { attachments, error }
}
