import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { FolderOpen } from 'lucide-react'
import type { ConductorSlashPicker } from '../../../../shared/conductor-composer-commands'
import styles from '../Conductor.module.css'

const PROMPT_COPY: Record<
  Extract<ConductorSlashPicker, 'dir-name' | 'file-path'>,
  { title: string; placeholder: string; browseLabel: string }
> = {
  'dir-name': {
    title: 'Add directory',
    placeholder: 'Folder name or path',
    browseLabel: 'Browse…',
  },
  'file-path': {
    title: 'Add file',
    placeholder: 'File name or path',
    browseLabel: 'Browse…',
  },
}

export function ConductorSlashNamePrompt({
  variant,
  onConfirm,
  onBrowse,
}: {
  variant: Extract<ConductorSlashPicker, 'dir-name' | 'file-path'>
  onConfirm: (value: string) => void
  onBrowse: () => Promise<string | null>
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const copy = PROMPT_COPY[variant]

  const submit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed) return
    onConfirm(trimmed)
  }, [onConfirm, value])

  const handleBrowse = useCallback(async () => {
    const picked = await onBrowse()
    if (picked) {
      setValue(picked)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [onBrowse])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        submit()
      }
    },
    [submit],
  )

  return (
    <div className={styles.conductorSlashNamePrompt} data-testid="conductor-slash-name-prompt">
      <div className={styles.conductorSlashNamePromptTitle}>{copy.title}</div>
      <input
        ref={inputRef}
        className={styles.conductorSlashNamePromptInput}
        type="text"
        value={value}
        placeholder={copy.placeholder}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className={styles.conductorSlashNamePromptBrowse}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void handleBrowse()}
      >
        <FolderOpen size={14} strokeWidth={1.8} aria-hidden />
        {copy.browseLabel}
      </button>
    </div>
  )
}
