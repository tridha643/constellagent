import { Image as ImageIcon } from 'lucide-react'
import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { normalizeConductorGeneratedImageOutput } from '../../../../../shared/conductor-generated-images'
import styles from '../../Conductor.module.css'

export function GeneratedImageTool({ tool }: { tool: TimelineToolCall }) {
  const output = normalizeConductorGeneratedImageOutput(tool.output)
  const images = output?.images ?? []

  if (images.length === 0) {
    return null
  }

  return (
    <div className={styles.generatedImageTool} data-testid="generated-image-tool">
      <div className={styles.generatedImageHeader}>
        <ImageIcon size={14} aria-hidden />
        <span>{tool.label}</span>
      </div>
      <div className={styles.generatedImageGrid}>
        {images.map((image, index) => {
          const label = image.prompt ?? image.name ?? image.filePath ?? `Generated image ${index + 1}`
          return (
            <figure className={styles.generatedImageFigure} key={image.id}>
              <img
                className={styles.generatedImage}
                src={`data:${image.mimeType};base64,${image.data}`}
                alt={label}
                loading="lazy"
                decoding="async"
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
          )
        })}
      </div>
    </div>
  )
}
