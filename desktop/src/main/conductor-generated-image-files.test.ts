import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadGeneratedImagesForTurn,
  loadLatestCodexGeneratedImages,
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
  test('loads image bytes from shell output paths', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'conductor-images-'))
    const iconPath = join(workspacePath, 'generated.png')
    await writeFile(iconPath, Buffer.from('png-bytes'))

    const output = await resolveConductorGeneratedImagesWithFiles(
      'Saved as generated.png',
      {
        workspacePath,
        toolName: 'shell',
      },
    )

    expect(output?.images).toHaveLength(1)
    expect(output?.images[0]?.data).toBe(Buffer.from('png-bytes').toString('base64'))
    expect(output?.images[0]?.filePath).toBe(iconPath)
  })
})

describe('loadGeneratedImagesForTurn', () => {
  test('hydrates assistant prose references', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'conductor-images-'))
    const iconPath = join(workspacePath, 'note-taking-app-icon.png')
    await writeFile(iconPath, Buffer.from('png-bytes'))

    const output = await loadGeneratedImagesForTurn(
      'Saved as `note-taking-app-icon.png`.',
      workspacePath,
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
        'Generated a simple notebook image.',
        workspacePath,
        { provider: 'codex' },
      )
      expect(output?.images[0]?.data).toBe(Buffer.from('codex-notebook').toString('base64'))
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previous
    }
  })
})
