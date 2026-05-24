import { useEffect, useRef, useState } from 'react'
import type { ModelPreset } from '../../../../shared/plan-build-command'
import {
  displayModelName,
  applyThinkingLevel,
  sameModelFamily,
  conductorModelPresets,
} from '../../../../shared/conductor-model-utils'
import type { AgentProvider } from '../../../../shared/agent-chat-types'
import type { ThinkingLevel } from '../../../../shared/conductor-thinking'
import { ProviderIcon } from './ConductorIcons'
import styles from '../Conductor.module.css'

const GROUPS: { provider: AgentProvider; label: string }[] = [
  { provider: 'cursor', label: 'Cursor' },
  { provider: 'codex', label: 'Codex' },
  { provider: 'pi', label: 'Pi' },
]

function labelFor(provider: AgentProvider, model: string): string {
  const preset = conductorModelPresets(provider).find((m) => m.cliModel === model)
  return displayModelName(preset?.label ?? model)
}

export function ChatModelSelector({
  provider,
  model,
  thinkingLevel = 'low',
  onSelect,
  workspacePath,
}: {
  provider: AgentProvider
  model: string
  thinkingLevel?: ThinkingLevel
  workspacePath: string
  onSelect: (provider: AgentProvider, model: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [piPresets, setPiPresets] = useState<readonly ModelPreset[]>(() => conductorModelPresets('pi'))
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open || !workspacePath) return
    let cancelled = false
    void window.api.agentChat
      .listPiModels(workspacePath)
      .then((models) => {
        if (!cancelled && models.length > 0) setPiPresets(models)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open, workspacePath])

  const presetsForProvider = (nextProvider: AgentProvider): readonly ModelPreset[] =>
    nextProvider === 'pi' ? piPresets : conductorModelPresets(nextProvider)

  return (
    <div className={styles.modelSelector} ref={rootRef}>
      <button
        type="button"
        className={`${styles.composerChip} ${styles.composerChipNeutral} ${styles.modelButton}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Change model (⌥P)"
      >
        <ProviderIcon provider={provider} size={15} />
        <span className={styles.modelButtonLabel}>{labelFor(provider, model)}</span>
      </button>
      {open && (
        <div className={styles.modelMenu} role="listbox">
          {GROUPS.map((group) => (
            <div key={group.provider}>
              <div className={styles.modelGroupLabel}>
                <ProviderIcon provider={group.provider} size={14} />
                {group.label}
              </div>
              {presetsForProvider(group.provider).map((preset) => {
                const effective =
                  group.provider === provider && provider === 'cursor'
                    ? applyThinkingLevel(model, thinkingLevel)
                    : preset.cliModel
                const active =
                  group.provider === provider &&
                  (provider === 'codex'
                    ? sameModelFamily(preset.cliModel, model)
                    : preset.cliModel === effective || sameModelFamily(preset.cliModel, model))
                return (
                  <button
                    key={`${group.provider}:${preset.cliModel}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`${styles.modelOption} ${active ? styles.modelOptionActive : ''}`}
                    onClick={() => {
                      onSelect(group.provider, preset.cliModel)
                      setOpen(false)
                    }}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
