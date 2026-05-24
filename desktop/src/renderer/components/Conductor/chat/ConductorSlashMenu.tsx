import { useEffect, useRef } from 'react'
import type { ConductorSlashCommand, ConductorSlashSection } from '../../../../shared/conductor-composer-commands'
import styles from '../Conductor.module.css'

function slashCommandLabel(command: string): string {
  return command.startsWith('/') ? command.slice(1) : command
}

export function ConductorSlashMenu({
  sections,
  selectedCommand,
  onSelect,
}: {
  sections: readonly ConductorSlashSection[]
  selectedCommand: ConductorSlashCommand | undefined
  onSelect: (command: ConductorSlashCommand) => void
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedCommand?.id])

  return (
    <div className={styles.conductorSlashMenu} data-testid="conductor-slash-menu">
      {sections.map((section) => (
        <div
          className={styles.conductorSlashSection}
          key={section.id}
          data-section={section.id}
        >
          {section.title ? (
            <div className={styles.conductorSlashSectionTitle}>{section.title}</div>
          ) : null}
          {section.items.map((command) => {
            const active = selectedCommand?.id === command.id
            return (
              <button
                key={command.id}
                ref={active ? activeRef : undefined}
                type="button"
                className={styles.conductorSlashMenuItem}
                data-active={active ? 'true' : undefined}
                data-kind={command.kind}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(command)}
              >
                <span className={styles.slashCommandToken}>
                  <span className={styles.slashCommandSlash}>/</span>
                  <span className={styles.slashCommandLabel}>{slashCommandLabel(command.command)}</span>
                </span>
                <span className={styles.slashCommandDesc}>{command.description}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
