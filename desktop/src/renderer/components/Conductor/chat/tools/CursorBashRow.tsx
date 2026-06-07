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

function unquoteShellArgument(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) return trimmed
  const quote = trimmed[0]
  if ((quote !== "'" && quote !== '"') || trimmed[trimmed.length - 1] !== quote) return trimmed
  const inner = trimmed.slice(1, -1)
  if (quote === "'") return inner.replace(/'\\''/g, "'")
  return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function commandDisplayLabel(command: string): string {
  const shellWrapped = command.match(/^(?:\/(?:usr\/)?bin\/)?(?:zsh|bash|sh)\s+-lc\s+([\s\S]+)$/)
  const usefulCommand = shellWrapped ? unquoteShellArgument(shellWrapped[1]) : command.trim()
  if (usefulCommand.length <= 168) return usefulCommand
  return `${usefulCommand.slice(0, 112).trimEnd()} ... ${usefulCommand.slice(-44).trimStart()}`
}

function shellOutput(output: unknown): string {
  if (typeof output === 'string') return stripAnsi(output).trim()
  return ''
}

export function CursorBashRow({ tool }: { tool: TimelineToolCall }) {
  const command = shellCommand(tool.input) || tool.label.trim()
  const commandLabel = commandDisplayLabel(command)
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
      <div className={`${styles.cursorToolRowMain} ${styles.cursorBashRowMain}`}>
        <button
          type="button"
          className={styles.cursorToolRowHit}
          data-testid="cursor-bash-row"
          onClick={onRowClick}
          aria-expanded={unlocked && Boolean(displayOutput)}
        >
          <span className={styles.cursorToolIcon} aria-hidden>
            <CursorBashIcon />
          </span>
          <span className={styles.cursorToolLabel}>Bash</span>
        </button>
        {command ? (
          <CursorToolChip
            variant="command"
            command={command}
            displayLabel={commandLabel}
            testId="cursor-bash-chip"
            onClick={(e) => e.stopPropagation()}
          />
        ) : null}
      </div>
      {unlocked && displayOutput ? <CursorBashOutput text={displayOutput} /> : null}
    </div>
  )
}
