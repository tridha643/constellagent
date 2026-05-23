import { describe, expect, test } from 'bun:test'
import { CONDUCTOR_MAX_IMAGE_BYTES } from './conductor-attachments'
import {
  extractConductorGeneratedImages,
  extractImagePathsFromText,
  hasRenderableGeneratedImageOutput,
  isConductorGeneratedImageOutput,
  isConductorGeneratedImageToolName,
  isGeneratedImageToolCall,
  looksLikeGeneratedImageCompletionText,
  turnTranscriptText,
} from './conductor-generated-images'

const tinyPng = 'iVBORw0KGgo='

describe('extractImagePathsFromText', () => {
  test('finds saved-as image paths in assistant prose', () => {
    expect(
      extractImagePathsFromText('Saved as `note-taking-app-icon.png`. If you want changes, say what to adjust.'),
    ).toEqual(['note-taking-app-icon.png'])
  })

  test('finds written image paths in shell output', () => {
    expect(extractImagePathsFromText('Wrote output to assets/hero-banner.webp')).toEqual([
      'assets/hero-banner.webp',
    ])
  })
})

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

describe('looksLikeGeneratedImageCompletionText', () => {
  test('detects codex imagegen completion prose without a file path', () => {
    expect(looksLikeGeneratedImageCompletionText('Generated a simple notebook image.')).toBe(true)
    expect(looksLikeGeneratedImageCompletionText('Using the `imagegen` skill because this is a raster request.')).toBe(
      true,
    )
    expect(looksLikeGeneratedImageCompletionText("I'll use the `imagegen` skill since this is a raster image generation request.")).toBe(
      true,
    )
    expect(looksLikeGeneratedImageCompletionText('Read src/utils.ts')).toBe(false)
  })
})

describe('turnTranscriptText', () => {
  test('includes structured tool input and output', () => {
    expect(
      turnTranscriptText([
        { kind: 'message', text: "I'll use the imagegen skill." },
        { kind: 'tool', toolName: 'shell', input: 'imagegen --prompt notebook', output: 'Saved as ig_test.png' },
      ]),
    ).toContain('imagegen --prompt notebook')
  })
})

describe('hasRenderableGeneratedImageOutput', () => {
  test('requires image data or a file path', () => {
    expect(
      hasRenderableGeneratedImageOutput({
        kind: 'generatedImages',
        images: [{ kind: 'generatedImage', id: 'a', mimeType: 'image/png', data: tinyPng }],
      }),
    ).toBe(true)
    expect(
      hasRenderableGeneratedImageOutput({
        kind: 'generatedImages',
        images: [{ kind: 'generatedImage', id: 'a', mimeType: 'image/png', filePath: '/tmp/a.png' }],
      }),
    ).toBe(true)
    expect(hasRenderableGeneratedImageOutput({ kind: 'generatedImages', images: [] })).toBe(false)
  })
})

describe('isGeneratedImageToolCall', () => {
  test('matches normalized image output and image tool names', () => {
    expect(
      isGeneratedImageToolCall({
        toolName: 'shell',
        output: {
          kind: 'generatedImages',
          images: [{ kind: 'generatedImage', id: 'a', mimeType: 'image/png', data: 'abc' }],
        },
      }),
    ).toBe(true)
    expect(isGeneratedImageToolCall({ toolName: 'generateImage', output: undefined })).toBe(true)
    expect(isGeneratedImageToolCall({ toolName: 'read', output: 'done' })).toBe(false)
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
