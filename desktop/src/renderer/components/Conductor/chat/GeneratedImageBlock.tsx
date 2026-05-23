import type { ConductorGeneratedImage } from '../../../../shared/conductor-generated-images'
import { conductorGeneratedImageSrc } from '../../../../shared/conductor-generated-image-src'
import styles from '../Conductor.module.css'

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
  const visible = images.flatMap((image, index) => {
    const src = conductorGeneratedImageSrc(image)
    if (!src) return []
    const label = image.prompt ?? image.name ?? image.filePath ?? `Generated image ${index + 1}`
    return [{ image, src, label }]
  })

  if (visible.length === 0 && !streaming) {
    return null
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
      {visible.length > 0 ? (
        <div className={styles.generatedImageGrid}>
          {visible.map(({ image, src, label }) => (
            <figure className={styles.generatedImageFigure} key={image.id}>
              <img
                alt={label}
                className={styles.generatedImage}
                decoding="async"
                loading="lazy"
                src={src}
                data-testid="generated-image"
              />
              {image.prompt || image.name || image.filePath ? (
                <figcaption className={styles.generatedImageCaption}>
                  {image.prompt ? <span className={styles.generatedImagePrompt}>{image.prompt}</span> : null}
                  {image.name || image.filePath ? (
                    <span className={styles.generatedImageMeta} title={image.filePath ?? image.name}>
                      {image.name ?? image.filePath}
                    </span>
                  ) : null}
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      ) : null}
    </div>
  )
}
