import { useState, type MouseEvent } from 'react'
import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { CursorBashIcon } from './CursorToolIcons'
import { CursorToolChip } from './CursorToolChip'
import { CursorBashOutput } from './CursorBashOutput'
import { stripAnsi } from './diff-utils'
import styles from './CursorTool.module.css'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function shellCommand(input: unknown): string {
  if (typeof input === 'string') return input
  const record = asRecord(input)
  const command = record?.command
  if (typeof command === 'string') return command
  return ''
}

function shellOutput(output: unknown): string {
  if (typeof output === 'string') return stripAnsi(output).trim()
  return ''
}

export function CursorBashRow({ tool }: { tool: TimelineToolCall }) {
  const command = shellCommand(tool.input) || tool.label.trim()
  const output = shellOutput(tool.output)
  const streamed = tool.status === 'running' ? stripAnsi(tool.detail ?? '').trim() : ''
  const displayOutput = streamed || output
  const [unlocked, setUnlocked] = useState(false)

  const onRowClick = (event: MouseEvent<HTMLButtonElement>) => {
    if ((event.target as HTMLElement).closest('[data-testid="diff-file-chip"]')) return
    setUnlocked((v) => !v)
  }

  return (
    <div className={styles.cursorToolRow} data-testid="cursor-tool-row">
      <button
        type="button"
        className={styles.cursorToolRowMain}
        data-testid="cursor-bash-row"
        onClick={onRowClick}
        aria-expanded={unlocked && Boolean(displayOutput)}
      >
        <span className={styles.cursorToolIcon} aria-hidden>
          <CursorBashIcon />
        </span>
        <span className={styles.cursorToolLabel}>Bash</span>
        {command ? (
          <CursorToolChip
            variant="command"
            command={command}
            testId="cursor-bash-chip"
            onClick={(e) => e.stopPropagation()}
          />
        ) : null}
      </button>
      {unlocked && displayOutput ? <CursorBashOutput text={displayOutput} /> : null}
    </div>
  )
}
