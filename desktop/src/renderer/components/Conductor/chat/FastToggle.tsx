import { LightningIcon } from './ConductorIcons'
import styles from '../Conductor.module.css'

export function FastToggle({
  active,
  onChange,
}: {
  active: boolean
  onChange: (fast: boolean) => void
}) {
  return (
    <button
      type="button"
      className={[
        styles.composerChip,
        active ? styles.composerChipWarm : styles.composerChipNeutral,
        styles.fastToggle,
        active ? '' : styles.fastToggleIconOnly,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-pressed={active}
      title={active ? 'Fast mode on' : 'Enable fast mode'}
      aria-label={active ? 'Fast mode on. Click to disable.' : 'Enable fast mode'}
      onClick={() => onChange(!active)}
    >
      <LightningIcon size={14} />
      {active ? <span className={styles.fastLabel}>Fast</span> : null}
    </button>
  )
}
