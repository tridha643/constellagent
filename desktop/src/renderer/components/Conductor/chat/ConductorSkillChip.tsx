import styles from '../Conductor.module.css'

function SkillChipIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      className={styles.conductorSkillChipIcon}
      aria-hidden
    >
      <path
        d="M3 2.5h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"
        strokeWidth="1.2"
      />
      <path d="M5 5.5h6M5 8h4" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** Inline pill shown when a harness skill is invoked from the Conductor chat composer. */
export function ConductorSkillChip({ name }: { name: string }) {
  return (
    <span className={styles.conductorSkillChip} title={`/${name}`} data-testid="conductor-skill-chip">
      <SkillChipIcon />
      <span className={styles.conductorSkillChipLabel}>{name}</span>
    </span>
  )
}
