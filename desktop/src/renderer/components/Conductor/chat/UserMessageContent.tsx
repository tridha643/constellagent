import { useMemo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isConductorHostSlashName } from '../../../../shared/conductor-composer-commands'
import {
  segmentMessageForInlineChips,
  type MessageSegment,
} from '../../../pi-gui/message-inline-segments'
import { markdownBasename } from '../../../utils/markdown-file-links'
import { MarkdownBody } from '../../Markdown/MarkdownBody'
import { ConductorSkillChip } from './ConductorSkillChip'
import { FilePathChip } from './FilePathChip'
import styles from '../Conductor.module.css'

const REMARK_PLUGINS = [remarkGfm]

/** Paragraphs as spans so chips + markdown share one inline text flow. */
const INLINE_MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => (
    <span className={styles.userMessageMdInline}>{children}</span>
  ),
} as const

function segmentToNode(segment: MessageSegment, index: number): ReactNode {
  switch (segment.kind) {
    case 'text':
      if (!segment.text) return null
      return (
        <ReactMarkdown
          key={`t-${index}`}
          remarkPlugins={REMARK_PLUGINS}
          components={INLINE_MARKDOWN_COMPONENTS}
        >
          {segment.text}
        </ReactMarkdown>
      )
    case 'file':
      return <FilePathChip key={`f-${index}`} path={segment.path} />
    case 'skillFile':
      return (
        <ConductorSkillChip
          key={`sf-${index}`}
          name={markdownBasename(segment.path)}
          path={segment.path}
          title={segment.path}
        />
      )
    case 'skillSlash':
      if (isConductorHostSlashName(segment.name)) {
        return (
          <span key={`h-${index}`} className={styles.userMessageHostSlash}>
            {segment.slash}
          </span>
        )
      }
      return (
        <ConductorSkillChip
          key={`s-${index}`}
          name={segment.name}
          label={segment.slash}
          title={segment.slash}
        />
      )
    default:
      return null
  }
}

function hasInlineSegmentChips(segments: readonly MessageSegment[]): boolean {
  return segments.some((segment) => segment.kind !== 'text')
}

/** User message body with inline file/skill chips for paths and harness `/skill` commands. */
export function UserMessageContent({ text }: { text: string }) {
  const segments = useMemo(() => segmentMessageForInlineChips(text), [text])
  const showSkillChips = hasInlineSegmentChips(segments)

  if (!showSkillChips) {
    return <MarkdownBody content={text} />
  }

  return (
    <div className={styles.userMessageSegmented} data-testid="user-message-segmented">
      {segments.map((segment, index) => segmentToNode(segment, index))}
    </div>
  )
}
