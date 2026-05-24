import { ImageIcon, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ConductorGeneratedImage } from '../../../../shared/conductor-generated-images'
import { conductorGeneratedImageSrc } from '../../../../shared/conductor-generated-image-src'
import styles from '../Conductor.module.css'

interface VisibleGeneratedImage {
  readonly image: ConductorGeneratedImage
  readonly src: string
  readonly label: string
}

export function GeneratedImageBlock({
  title,
  description,
  images,
  streaming = false,
}: {
  title?: string
  description?: string
  images: readonly ConductorGeneratedImage[]
  streaming?: boolean
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const visible = useMemo(
    () =>
      images.flatMap((image, index): VisibleGeneratedImage[] => {
        const src = conductorGeneratedImageSrc(image)
        if (!src) return []
        const label = image.prompt ?? image.name ?? image.filePath ?? `Generated image ${index + 1}`
        return [{ image, src, label }]
      }),
    [images],
  )
  const selected = selectedIndex === null ? undefined : visible[selectedIndex]
  const pillLabel = title || (visible.length === 1 ? 'Generated image' : `Generated ${visible.length} images`)

  useEffect(() => {
    if (!selected) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedIndex(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected])

  useEffect(() => {
    if (selectedIndex !== null && selectedIndex >= visible.length) {
      setSelectedIndex(visible.length > 0 ? visible.length - 1 : null)
    }
  }, [selectedIndex, visible.length])

  if (visible.length === 0 && !streaming) {
    return null
  }

  if (visible.length > 0) {
    return (
      <>
        <div className={styles.generatedImageTool} data-testid="generated-image-block">
          <button
            type="button"
            className={styles.generatedImageOpenPill}
            onClick={() => setSelectedIndex(0)}
            aria-haspopup="dialog"
            aria-expanded={Boolean(selected)}
          >
            <ImageIcon className={styles.toolInlineChipIcon} aria-hidden />
            <span className={styles.toolInlineChipLabel}>{pillLabel}</span>
          </button>
          {description ? <div className={styles.generatedImagePillDescription}>{description}</div> : null}
        </div>
        {selected ? (
          <div
            className={styles.generatedImageLightboxBackdrop}
            role="dialog"
            aria-modal="true"
            aria-label={selected.label}
            onClick={() => setSelectedIndex(null)}
            data-testid="generated-image-lightbox"
          >
            <div className={styles.generatedImageLightbox} onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className={styles.generatedImageLightboxClose}
                onClick={() => setSelectedIndex(null)}
                aria-label="Close image"
              >
                <X size={16} aria-hidden />
              </button>
              <img
                alt={selected.label}
                className={styles.generatedImageLightboxImage}
                decoding="async"
                src={selected.src}
                data-testid="generated-image"
              />
              {selected.image.prompt || selected.image.name || selected.image.filePath ? (
                <div className={styles.generatedImageLightboxCaption}>
                  {selected.image.prompt ? (
                    <span className={styles.generatedImagePrompt}>{selected.image.prompt}</span>
                  ) : null}
                  {selected.image.name || selected.image.filePath ? (
                    <span className={styles.generatedImageMeta} title={selected.image.filePath ?? selected.image.name}>
                      {selected.image.name ?? selected.image.filePath}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {visible.length > 1 ? (
                <div className={styles.generatedImageThumbs} aria-label="Generated images">
                  {visible.map(({ image, src, label }, index) => (
                    <button
                      type="button"
                      className={styles.generatedImageThumb}
                      data-active={index === selectedIndex ? 'true' : undefined}
                      key={image.id}
                      onClick={() => setSelectedIndex(index)}
                      aria-label={label}
                    >
                      <img alt="" src={src} decoding="async" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <div
      className={`${styles.jsonCanvasBlock} ${streaming ? styles.jsonCanvasBlockStreaming : ''}`}
      data-testid="generated-image-block"
    >
      {title ? <div className={styles.jsonCanvasBlockTitle}>{title}</div> : null}
      {description ? <div className={styles.jsonCanvasBlockDescription}>{description}</div> : null}
      {streaming && visible.length === 0 ? (
        <div className={styles.jsonCanvasBlockDescription}>Generating image…</div>
      ) : null}
    </div>
  )
}
