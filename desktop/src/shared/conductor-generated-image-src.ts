import type { ConductorGeneratedImage } from './conductor-generated-images'

function filePathToFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const encoded = normalized
    .split('/')
    .map((part, index) => (index === 0 && part === '' ? '' : encodeURIComponent(part)))
    .join('/')
  return `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`
}

/** Build an `<img src>` for a generated image with inline data or a local file path. */
export function conductorGeneratedImageSrc(image: ConductorGeneratedImage): string | undefined {
  if (image.data) {
    return `data:${image.mimeType};base64,${image.data}`
  }
  if (!image.filePath) return undefined
  if (/^file:/i.test(image.filePath)) return image.filePath
  return filePathToFileUrl(image.filePath)
}
