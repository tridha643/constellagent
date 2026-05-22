/// <reference lib="dom" />

import { describe, expect, test } from 'bun:test'
import { CONDUCTOR_MAX_IMAGE_BYTES } from '../../../../shared/conductor-attachments'
import { mergeConductorAttachments, readConductorImageAttachmentsFromFiles } from './conductor-attachments'

describe('readConductorImageAttachmentsFromFiles', () => {
  test('rejects unsupported formats with an error', async () => {
    const file = new File(['heic-bytes'], 'photo.heic', { type: 'image/heic' })
    const result = await readConductorImageAttachmentsFromFiles([file])

    expect(result.attachments).toEqual([])
    expect(result.rejectedCount).toBe(1)
    expect(result.error).toContain('Unsupported image format')
  })

  test('rejects oversize files before reading', async () => {
    const bytes = new Uint8Array(CONDUCTOR_MAX_IMAGE_BYTES + 1)
    const file = new File([bytes], 'large.png', { type: 'image/png' })
    const result = await readConductorImageAttachmentsFromFiles([file])

    expect(result.attachments).toEqual([])
    expect(result.rejectedCount).toBe(1)
    expect(result.error).toContain('20 MB')
  })
})

describe('mergeConductorAttachments', () => {
  test('dedupes by attachment signature', () => {
    const attachment = {
      id: 'a1',
      kind: 'image' as const,
      name: 'shot.png',
      mimeType: 'image/png' as const,
      data: 'abc123',
    }

    const merged = mergeConductorAttachments([attachment], [attachment])
    expect(merged).toHaveLength(1)
  })
})
