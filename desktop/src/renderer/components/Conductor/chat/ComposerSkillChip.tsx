import { X } from 'lucide-react'
import { useAppStore } from '../../../store/app-store'
import { SharedFileIcon } from '../../../utils/file-presentation'
import styles from '../Conductor.module.css'

export interface ConductorSkillMention {
  readonly id: string
  readonly name: string
  readonly command: string
  readonly sourcePath?: string
}

export function createConductorSkillMention(input: {
  name: string
  command: string
  sourcePath?: string
}): ConductorSkillMention {
  return {
    id: crypto.randomUUID(),
    name: input.name,
    command: input.command,
    sourcePath: input.sourcePath,
  }
}

export function ComposerSkillChip({
  mention,
  onRemove,
}: {
  mention: ConductorSkillMention
  onRemove?: (id: string) => void
}) {
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const label = mention.name
  const iconPath = mention.sourcePath ?? `${mention.name}.md`

  return (
    <span className={styles.composerFileChip} data-testid="composer-skill-chip">
      <span
        className={styles.composerFileChipMain}
        title={mention.sourcePath ?? mention.command}
      >
        <span className={styles.composerFileChipIconWrap}>
          <SharedFileIcon
            path={iconPath}
            appearanceThemeId={appearanceThemeId}
            className={styles.composerFileChipIcon}
          />
        </span>
        <span className={styles.composerFileChipDivider} aria-hidden />
        <span className={styles.composerFileChipLabel}>{label}</span>
      </span>
      {onRemove ? (
        <button
          type="button"
          className={styles.composerFileChipRemove}
          aria-label={`Remove ${label}`}
          onClick={() => onRemove(mention.id)}
        >
          <X size={12} strokeWidth={2} />
        </button>
      ) : null}
    </span>
  )
}
