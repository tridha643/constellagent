import { useMemo, type ReactNode } from 'react'
import { isConductorHostSlashName } from '../../../../shared/conductor-composer-commands'
import {
  segmentMessageForInlineChips,
  type MessageSegment,
} from '../../../pi-gui/message-inline-segments'
import { MarkdownBody } from '../../Markdown/MarkdownBody'
import { ConductorSkillChip } from './ConductorSkillChip'
import styles from '../Conductor.module.css'

function segmentToNode(segment: MessageSegment, index: number): ReactNode {
  switch (segment.kind) {
    case 'text':
      return segment.text.trim() ? (
        <MarkdownBody key={`t-${index}`} content={segment.text} inline />
      ) : null
    case 'skillSlash':
      if (isConductorHostSlashName(segment.name)) {
        return <MarkdownBody key={`h-${index}`} content={segment.slash} inline />
      }
      return <ConductorSkillChip key={`s-${index}`} name={segment.name} />
    default:
      return null
  }
}

function hasSkillInvocationChip(segments: readonly MessageSegment[]): boolean {
  return segments.some(
    (segment) => segment.kind === 'skillSlash' && !isConductorHostSlashName(segment.name),
  )
}

/** User message body with inline skill-invocation chips for harness `/skill` commands. */
export function UserMessageContent({ text }: { text: string }) {
  const segments = useMemo(() => segmentMessageForInlineChips(text), [text])
  const showSkillChips = hasSkillInvocationChip(segments)

  if (!showSkillChips) {
    return <MarkdownBody content={text} />
  }

  return (
    <div className={styles.userMessageSegmented} data-testid="user-message-segmented">
      {segments.map((segment, index) => segmentToNode(segment, index))}
    </div>
  )
}
