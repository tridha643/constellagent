import { useAppStore } from '../../../store/app-store'
import { SharedFileIcon } from '../../../utils/file-presentation'
import styles from '../Conductor.module.css'

/** Inline pill shown when a harness skill is invoked from the Conductor chat composer. */
export function ConductorSkillChip({
  name,
  title,
  path,
}: {
  name: string
  title?: string
  path?: string
}) {
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const iconPath = path ?? `${name}.md`

  return (
    <span className={styles.conductorSkillChip} title={title ?? `/${name}`} data-testid="conductor-skill-chip">
      <SharedFileIcon
        path={iconPath}
        appearanceThemeId={appearanceThemeId}
        className={styles.conductorSkillChipIcon}
      />
      <span className={styles.conductorSkillChipLabel}>{name}</span>
    </span>
  )
}
