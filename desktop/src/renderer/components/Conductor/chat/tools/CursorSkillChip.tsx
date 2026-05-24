import styles from './CursorTool.module.css'

function SkillChipIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={10}
      height={10}
      fill="none"
      stroke="currentColor"
      className={styles.cursorSkillChipIcon}
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

/** Compact skill pill for tool rows (skill load, harness invocations). */
export function CursorSkillChip({ name, title }: { name: string; title?: string }) {
  return (
    <span className={styles.cursorSkillChip} title={title ?? name} data-testid="cursor-skill-chip">
      <SkillChipIcon />
      <span className={styles.cursorSkillChipLabel}>{name}</span>
    </span>
  )
}
