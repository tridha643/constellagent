import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadGeneratedImagesForTurn,
  resolveConductorGeneratedImagesWithFiles,
  resolveGeneratedImagePath,
} from './conductor-generated-image-files'

describe('resolveGeneratedImagePath', () => {
  test('resolves workspace-relative and assets paths', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'conductor-images-'))
    const assetsDir = join(workspacePath, 'assets')
    const iconPath = join(assetsDir, 'note-taking-app-icon.png')
    await mkdir(assetsDir, { recursive: true })
    await writeFile(iconPath, Buffer.from('png-bytes'))

    expect(resolveGeneratedImagePath('assets/note-taking-app-icon.png', workspacePath)).toBe(iconPath)
    expect(resolveGeneratedImagePath('note-taking-app-icon.png', workspacePath)).toBe(iconPath)
  })
})

describe('resolveConductorGeneratedImagesWithFiles', () => {
  test('loads image bytes from Codex imagegen output paths', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'conductor-images-'))
    const iconPath = join(workspacePath, 'generated.png')
    await writeFile(iconPath, Buffer.from('png-bytes'))

    const output = await resolveConductorGeneratedImagesWithFiles(
      'Saved as generated.png',
      {
        workspacePath,
        toolName: 'image_gen',
        provider: 'codex',
      },
    )

    expect(output?.images).toHaveLength(1)
    expect(output?.images[0]?.data).toBe(Buffer.from('png-bytes').toString('base64'))
    expect(output?.images[0]?.filePath).toBe(iconPath)
  })

  test('ignores generated-image-looking paths outside Codex imagegen', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'conductor-images-'))
    const iconPath = join(workspacePath, 'generated.png')
    await writeFile(iconPath, Buffer.from('png-bytes'))

    const output = await resolveConductorGeneratedImagesWithFiles(
      'Saved as generated.png',
      {
        workspacePath,
        toolName: 'shell',
        provider: 'codex',
      },
    )

    expect(output).toBeUndefined()
  })

  test('falls back to latest Codex image when a referenced relative path is missing', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'conductor-images-'))
    const codexHome = join(workspacePath, 'codex-home')
    const imagePath = join(codexHome, 'generated_images', 'session-c', 'real.png')
    await mkdir(dirname(imagePath), { recursive: true })
    await writeFile(imagePath, Buffer.from('real-image'))

    const previous = process.env.CODEX_HOME
    process.env.CODEX_HOME = codexHome
    try {
      const output = await resolveConductorGeneratedImagesWithFiles(
        'Saved as screenshot.png',
        {
          workspacePath,
          toolName: 'image_gen',
          provider: 'codex',
        },
      )

      expect(output?.images).toHaveLength(1)
      expect(output?.images[0]?.data).toBe(Buffer.from('real-image').toString('base64'))
      expect(output?.images[0]?.filePath).toBe(imagePath)
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previous
    }
  })
})

describe('loadGeneratedImagesForTurn', () => {
  test('hydrates assistant prose references', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'conductor-images-'))
    const iconPath = join(workspacePath, 'note-taking-app-icon.png')
    await writeFile(iconPath, Buffer.from('png-bytes'))

    const output = await loadGeneratedImagesForTurn(
      'imagegen saved as `note-taking-app-icon.png`.',
      workspacePath,
      { provider: 'codex' },
    )

    expect(output?.images[0]?.mimeType).toBe('image/png')
    expect(output?.images[0]?.data).toBe(Buffer.from('png-bytes').toString('base64'))
  })

  test('falls back to CODEX_HOME when completion prose has no path', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'conductor-images-'))
    const codexHome = join(workspacePath, 'codex-home')
    const imagePath = join(codexHome, 'generated_images', 'session-b', 'notebook.png')
    await mkdir(dirname(imagePath), { recursive: true })
    await writeFile(imagePath, Buffer.from('codex-notebook'))

    const previous = process.env.CODEX_HOME
    process.env.CODEX_HOME = codexHome
    try {
      const output = await loadGeneratedImagesForTurn(
        'Used imagegen to generate a simple notebook image.',
        workspacePath,
        { provider: 'codex' },
      )
      expect(output?.images[0]?.data).toBe(Buffer.from('codex-notebook').toString('base64'))
      expect(output?.images).toHaveLength(1)
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previous
    }
  })

  test('loads only the newest Codex imagegen file', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'conductor-images-'))
    const codexHome = join(workspacePath, 'codex-home')
    const oldPath = join(codexHome, 'generated_images', 'session-a', 'old.png')
    const newPath = join(codexHome, 'generated_images', 'session-b', 'new.png')
    await mkdir(dirname(oldPath), { recursive: true })
    await mkdir(dirname(newPath), { recursive: true })
    await writeFile(oldPath, Buffer.from('old-image'))
    await writeFile(newPath, Buffer.from('new-image'))
    await utimes(oldPath, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
    await utimes(newPath, new Date('2026-01-01T00:00:02Z'), new Date('2026-01-01T00:00:02Z'))

    const previous = process.env.CODEX_HOME
    process.env.CODEX_HOME = codexHome
    try {
      const output = await loadGeneratedImagesForTurn(
        'Using imagegen.',
        workspacePath,
        { provider: 'codex', sinceMs: Date.parse('2025-12-31T23:59:59Z') },
      )
      expect(output?.images).toHaveLength(1)
      expect(output?.images[0]?.filePath).toBe(newPath)
      expect(output?.images[0]?.data).toBe(Buffer.from('new-image').toString('base64'))
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previous
    }
  })
})
