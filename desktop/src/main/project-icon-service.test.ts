import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearCustomIcon,
  getCustomIconDataUrl,
  projectIconPath,
  storeCustomIconBytes,
  MAX_PROJECT_ICON_BYTES,
} from './project-icon-service'

// Minimal byte sequences that satisfy the magic-byte sniffer.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const NOT_AN_IMAGE = Buffer.from('hello world this is not an image', 'utf8')

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'project-icons-'))
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

describe('project-icon-service', () => {
  it('stores and reads back a PNG as a data URL', async () => {
    await storeCustomIconBytes(baseDir, 'proj-1', PNG_BYTES)
    const url = await getCustomIconDataUrl(baseDir, 'proj-1')
    expect(url).toBeTruthy()
    expect(url!.startsWith('data:image/png;base64,')).toBe(true)
    // Round-trips the exact bytes.
    const b64 = url!.split(',')[1]
    expect(Buffer.from(b64, 'base64').equals(PNG_BYTES)).toBe(true)
  })

  it('detects JPEG from magic bytes', async () => {
    await storeCustomIconBytes(baseDir, 'proj-jpeg', JPEG_BYTES)
    const url = await getCustomIconDataUrl(baseDir, 'proj-jpeg')
    expect(url!.startsWith('data:image/jpeg;base64,')).toBe(true)
  })

  it('returns null when no icon is stored', async () => {
    expect(await getCustomIconDataUrl(baseDir, 'missing')).toBeNull()
  })

  it('clears a stored icon (and is a no-op when already gone)', async () => {
    await storeCustomIconBytes(baseDir, 'proj-2', PNG_BYTES)
    expect(existsSync(projectIconPath(baseDir, 'proj-2'))).toBe(true)
    await clearCustomIcon(baseDir, 'proj-2')
    expect(existsSync(projectIconPath(baseDir, 'proj-2'))).toBe(false)
    expect(await getCustomIconDataUrl(baseDir, 'proj-2')).toBeNull()
    // Second clear must not throw.
    await clearCustomIcon(baseDir, 'proj-2')
  })

  it('rejects unsupported formats', async () => {
    await expect(storeCustomIconBytes(baseDir, 'proj-3', NOT_AN_IMAGE)).rejects.toThrow()
    expect(existsSync(projectIconPath(baseDir, 'proj-3'))).toBe(false)
  })

  it('rejects oversize files', async () => {
    const tooBig = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_PROJECT_ICON_BYTES + 1)])
    await expect(storeCustomIconBytes(baseDir, 'proj-4', tooBig)).rejects.toThrow()
  })

  it('rejects unsafe project ids (path traversal)', () => {
    expect(() => projectIconPath(baseDir, '../escape')).toThrow()
    expect(() => projectIconPath(baseDir, 'a/b')).toThrow()
  })
})
