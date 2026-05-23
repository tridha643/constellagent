import type { TimelineToolCall } from '../../../../../shared/pi/timeline-types'
import { skillDisplayFromToolInput } from '../../../../../shared/skill-tool-utils'
import { CursorToolChip } from './CursorToolChip'
import styles from './CursorTool.module.css'

function SkillLoadIcon() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M3 2.5h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"
        strokeWidth="1.2"
      />
      <path d="M5 5.5h6M5 8h4" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** Compact row for native SDK skill-load tool calls (Cursor/Codex when surfaced). */
export function SkillLoadTool({ tool }: { tool: TimelineToolCall }) {
  const { label, skillId } = skillDisplayFromToolInput(tool.input)
  const displayLabel = tool.label.trim() || `Loaded ${label} skill`

  return (
    <div
      className={`${styles.cursorToolRow} ${styles.cursorToolRowSkillLoad}`}
      data-testid="cursor-tool-row"
    >
      <div className={styles.cursorToolRowMain} data-testid="skill-load-row">
        <span className={styles.cursorToolIcon} aria-hidden>
          <SkillLoadIcon />
        </span>
        <span className={styles.cursorToolLabel}>{displayLabel}</span>
        {skillId ? (
          <CursorToolChip variant="file" path={skillId} onClick={(event) => event.preventDefault()} />
        ) : null}
      </div>
    </div>
  )
}
