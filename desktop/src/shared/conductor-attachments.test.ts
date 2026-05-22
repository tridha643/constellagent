import { describe, expect, test } from 'bun:test'
import {
  CONDUCTOR_MAX_IMAGE_BYTES,
  formatConductorImageSizeLimit,
  inferConductorImageMimeType,
  isSupportedConductorImageMimeType,
} from './conductor-attachments'

describe('inferConductorImageMimeType', () => {
  test('accepts supported mime types', () => {
    expect(inferConductorImageMimeType('photo.png', 'image/png')).toBe('image/png')
    expect(inferConductorImageMimeType('photo.jpg', 'image/jpeg')).toBe('image/jpeg')
  })

  test('infers from file extension when mime is empty', () => {
    expect(inferConductorImageMimeType('screenshot.png', '')).toBe('image/png')
    expect(inferConductorImageMimeType('photo.JPEG', undefined)).toBe('image/jpeg')
  })

  test('rejects unsupported formats', () => {
    expect(inferConductorImageMimeType('photo.heic', 'image/heic')).toBeUndefined()
    expect(inferConductorImageMimeType('doc.pdf', 'application/pdf')).toBeUndefined()
  })
})

describe('formatConductorImageSizeLimit', () => {
  test('matches configured max bytes', () => {
    expect(formatConductorImageSizeLimit()).toBe(`${CONDUCTOR_MAX_IMAGE_BYTES / (1024 * 1024)} MB`)
  })
})

describe('isSupportedConductorImageMimeType', () => {
  test('guards supported mime union', () => {
    expect(isSupportedConductorImageMimeType('image/webp')).toBe(true)
    expect(isSupportedConductorImageMimeType('image/heic')).toBe(false)
  })
})
