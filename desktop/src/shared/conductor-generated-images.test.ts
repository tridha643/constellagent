import { describe, expect, test } from 'bun:test'
import { CONDUCTOR_MAX_IMAGE_BYTES } from './conductor-attachments'
import {
  extractConductorGeneratedImages,
  isConductorGeneratedImageOutput,
  isConductorGeneratedImageToolName,
} from './conductor-generated-images'

const tinyPng = 'iVBORw0KGgo='

describe('extractConductorGeneratedImages', () => {
  test('extracts Cursor generateImage results', () => {
    const output = extractConductorGeneratedImages(
      {
        status: 'success',
        value: {
          filePath: '/tmp/cat.png',
          imageData: tinyPng,
        },
      },
      {
        provider: 'cursor',
        toolName: 'generateImage',
        input: { description: 'a cat in a chair' },
      },
    )

    expect(output?.kind).toBe('generatedImages')
    expect(output?.images).toHaveLength(1)
    expect(output?.images[0]).toMatchObject({
      kind: 'generatedImage',
      mimeType: 'image/png',
      data: tinyPng,
      filePath: '/tmp/cat.png',
      name: 'cat.png',
      prompt: 'a cat in a chair',
      provider: 'cursor',
    })
  })

  test('extracts MCP image content blocks', () => {
    const output = extractConductorGeneratedImages(
      {
        content: [
          { type: 'text', text: 'created an image' },
          { type: 'image', data: tinyPng, mimeType: 'image/webp' },
        ],
      },
      { provider: 'codex', toolName: 'image_gen' },
    )

    expect(output?.images).toHaveLength(1)
    expect(output?.images[0]?.mimeType).toBe('image/webp')
    expect(output?.images[0]?.data).toBe(tinyPng)
    expect(output?.images[0]?.provider).toBe('codex')
  })

  test('extracts data URLs and OpenAI-style b64_json values', () => {
    const dataUrlOutput = extractConductorGeneratedImages({
      image: { data: `data:image/jpeg;base64,${tinyPng}` },
    })
    const b64Output = extractConductorGeneratedImages(
      { data: [{ b64_json: tinyPng, revised_prompt: 'revised' }] },
      { toolName: 'image_generation' },
    )

    expect(dataUrlOutput?.images[0]?.mimeType).toBe('image/jpeg')
    expect(b64Output?.images[0]?.mimeType).toBe('image/png')
    expect(b64Output?.images[0]?.prompt).toBe('revised')
  })

  test('rejects unsupported MIME and oversized image data', () => {
    const unsupported = extractConductorGeneratedImages({
      content: [{ type: 'image', data: tinyPng, mimeType: 'image/heic' }],
    })
    const oversized = extractConductorGeneratedImages(
      { imageData: 'a'.repeat(Math.ceil((CONDUCTOR_MAX_IMAGE_BYTES + 1) / 3) * 4) },
      { toolName: 'generateImage' },
    )

    expect(unsupported).toBeUndefined()
    expect(oversized).toBeUndefined()
  })
})

describe('isConductorGeneratedImageOutput', () => {
  test('guards normalized output', () => {
    expect(
      isConductorGeneratedImageOutput({
        kind: 'generatedImages',
        images: [{ kind: 'generatedImage', id: 'image-1', mimeType: 'image/png', data: tinyPng }],
      }),
    ).toBe(true)
    expect(isConductorGeneratedImageOutput({ kind: 'generatedImages', images: [] })).toBe(false)
  })
})

describe('isConductorGeneratedImageToolName', () => {
  test('matches common image generation tool names', () => {
    expect(isConductorGeneratedImageToolName('generateImage')).toBe(true)
    expect(isConductorGeneratedImageToolName('image_gen')).toBe(true)
    expect(isConductorGeneratedImageToolName('openai.image_generation')).toBe(true)
    expect(isConductorGeneratedImageToolName('read_file')).toBe(false)
  })
})
