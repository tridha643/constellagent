import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Per-project custom icon storage. A picked PNG/JPEG/WebP/GIF is copied byte-for-
 * byte into `userData/project-icons/<projectId>` so it survives the source file
 * moving or being deleted (modeled on `conductor-image-picker.ts`).
 *
 * The core file ops take an explicit `baseDir` so they're unit-testable without
 * an Electron runtime; the IPC layer resolves `baseDir` from `app.getPath`.
 * Electron-only APIs (`dialog`) are loaded lazily inside the picker.
 */

export const PROJECT_ICONS_DIRNAME = 'project-icons'
export const MAX_PROJECT_ICON_BYTES = 2 * 1024 * 1024 // 2 MB

const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const

export interface PickCustomIconResult {
  readonly dataUrl?: string
  readonly error?: string
  readonly canceled?: boolean
}

function formatSizeLimit(): string {
  return `${Math.round(MAX_PROJECT_ICON_BYTES / (1024 * 1024))}MB`
}

/** Reject ids that could escape the icons directory; project ids are UUIDs. */
function assertSafeProjectId(projectId: string): void {
  if (!projectId || projectId.includes('/') || projectId.includes('\\') || projectId.includes('..')) {
    throw new Error('Invalid project id for icon storage')
  }
}

export function projectIconPath(baseDir: string, projectId: string): string {
  assertSafeProjectId(projectId)
  return join(baseDir, projectId)
}

/** Sniff a supported image MIME from magic bytes (we store without an extension). */
function sniffImageMime(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  ) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 4) === 'GIF8') {
    return 'image/gif'
  }
  return null
}

/** Validate + copy raw image bytes into the project's icon slot. */
export async function storeCustomIconBytes(
  baseDir: string,
  projectId: string,
  buffer: Buffer,
): Promise<void> {
  if (buffer.byteLength > MAX_PROJECT_ICON_BYTES) {
    throw new Error(`Image exceeds ${formatSizeLimit()} limit.`)
  }
  if (!sniffImageMime(buffer)) {
    throw new Error('Unsupported image format. Use PNG, JPEG, WebP, or GIF.')
  }
  await mkdir(baseDir, { recursive: true })
  await writeFile(projectIconPath(baseDir, projectId), buffer)
}

/** Read the stored icon back as a `data:` URL, or null when absent/unreadable. */
export async function getCustomIconDataUrl(
  baseDir: string,
  projectId: string,
): Promise<string | null> {
  try {
    const buffer = await readFile(projectIconPath(baseDir, projectId))
    const mime = sniffImageMime(buffer)
    if (!mime) return null
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

/** Remove a project's stored icon (no-op when none exists). */
export async function clearCustomIcon(baseDir: string, projectId: string): Promise<void> {
  try {
    await unlink(projectIconPath(baseDir, projectId))
  } catch {
    // Already gone — nothing to clean up.
  }
}

/**
 * Open the native picker, copy the chosen image into the project's icon slot,
 * and return its `data:` URL. Returns `{ canceled }` when the user backs out and
 * `{ error }` on an unsupported/oversize file.
 */
export async function pickAndStoreCustomIcon(
  baseDir: string,
  projectId: string,
): Promise<PickCustomIconResult> {
  const { dialog } = await import('electron')
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: 'Choose project icon',
    filters: [{ name: 'Images', extensions: [...ALLOWED_EXTENSIONS] }],
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }

  let buffer: Buffer
  try {
    buffer = await readFile(result.filePaths[0])
  } catch {
    return { error: 'Could not read the selected file.' }
  }

  try {
    await storeCustomIconBytes(baseDir, projectId, buffer)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to store icon.' }
  }

  const dataUrl = await getCustomIconDataUrl(baseDir, projectId)
  return dataUrl ? { dataUrl } : { error: 'Failed to read the stored icon.' }
}
