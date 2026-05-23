import { describe, expect, test } from 'bun:test'
import { conductorGeneratedImageSrc } from './conductor-generated-image-src'

describe('conductorGeneratedImageSrc', () => {
  test('uses inline image data when present', () => {
    expect(
      conductorGeneratedImageSrc({
        kind: 'generatedImage',
        id: 'image-1',
        mimeType: 'image/png',
        data: 'abc',
      }),
    ).toBe('data:image/png;base64,abc')
  })

  test('does not turn unresolved relative paths into broken file URLs', () => {
    expect(
      conductorGeneratedImageSrc({
        kind: 'generatedImage',
        id: 'image-1',
        mimeType: 'image/png',
        filePath: 'screenshot.png',
      }),
    ).toBeUndefined()
  })

  test('converts absolute local paths to file URLs', () => {
    expect(
      conductorGeneratedImageSrc({
        kind: 'generatedImage',
        id: 'image-1',
        mimeType: 'image/png',
        filePath: '/tmp/screenshot space.png',
      }),
    ).toBe('file:///tmp/screenshot%20space.png')
  })
})
