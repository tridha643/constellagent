import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import {
  CONDUCTOR_PERSONALITY_OPTIONS,
  type ConductorPersonalityOption,
} from '../../../../shared/conductor-composer-commands'
import styles from '../Conductor.module.css'

export function ConductorPersonalityMenu({
  selectedIndex,
  onSelect,
}: {
  selectedIndex: number
  onSelect: (value: string) => void
}) {
  const [activePersonality, setActivePersonality] = useState<string>('pragmatic')
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    void window.api.codex.getPersonality().then((result) => {
      setActivePersonality(result.personality)
    })
  }, [])

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const renderRow = (option: ConductorPersonalityOption, index: number) => {
    const active = selectedIndex === index
    const checked = activePersonality === option.value
    return (
      <button
        key={option.value}
        ref={active ? activeRef : undefined}
        type="button"
        className={styles.conductorPersonalityMenuItem}
        data-active={active ? 'true' : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setActivePersonality(option.value)
          onSelect(option.value)
        }}
      >
        <span className={styles.conductorPersonalityLabel}>{option.label}</span>
        <span className={styles.conductorPersonalityDesc}>{option.description}</span>
        {checked ? (
          <Check className={styles.conductorPersonalityCheck} size={14} strokeWidth={2.2} aria-hidden />
        ) : null}
      </button>
    )
  }

  return (
    <div className={styles.conductorPersonalityMenu} data-testid="conductor-personality-menu">
      {CONDUCTOR_PERSONALITY_OPTIONS.map((option, index) => renderRow(option, index))}
    </div>
  )
}
