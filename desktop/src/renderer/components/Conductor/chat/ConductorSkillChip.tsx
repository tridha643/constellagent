import { useAppStore } from '../../../store/app-store'
import { SharedFileIcon } from '../../../utils/file-presentation'
import styles from '../Conductor.module.css'

/** Inline pill shown when a harness skill is invoked from the Conductor chat composer. */
export function ConductorSkillChip({
  name,
  label,
  title,
  path,
}: {
  /** Skill id (no leading slash) — used for icon fallback when `path` is omitted. */
  name: string
  /** Visible chip text; defaults to `/${name}` or preserves a leading slash when `name` already has one. */
  label?: string
  title?: string
  path?: string
}) {
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const skillId = name.replace(/^\//, '')
  const displayLabel = label ?? (name.startsWith('/') ? name : `/${skillId}`)
  const iconPath = path ?? `${skillId}.md`

  return (
    <span className={styles.conductorSkillChip} title={title ?? displayLabel} data-testid="conductor-skill-chip">
      <SharedFileIcon
        path={iconPath}
        appearanceThemeId={appearanceThemeId}
        className={styles.conductorSkillChipIcon}
      />
      <span className={styles.conductorSkillChipLabel}>{displayLabel}</span>
    </span>
  )
}
