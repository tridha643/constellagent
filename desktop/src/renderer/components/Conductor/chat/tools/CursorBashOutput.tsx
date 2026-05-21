import { useMemo, type ReactNode } from 'react'
import styles from './CursorTool.module.css'

const KEYWORD_RE = /\b(for|in|do|if|else|while|export|import|const|let|var|function|return|await|async)\b/g
const SUCCESS_RE = /✓|built in \d|success|succeeded/i

function colorizeLine(line: string): ReactNode {
  if (SUCCESS_RE.test(line)) {
    return <span className={styles.cursorBashSuccess}>{line}</span>
  }
  if (line.startsWith('>')) {
    return (
      <>
        <span className={styles.cursorBashPrompt}>{'>'}</span>
        {line.slice(1)}
      </>
    )
  }

  const parts: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  const re = new RegExp(KEYWORD_RE.source, 'g')
  while ((match = re.exec(line)) !== null) {
    if (match.index > last) parts.push(line.slice(last, match.index))
    parts.push(
      <span key={match.index} className={styles.cursorBashKeyword}>
        {match[0]}
      </span>,
    )
    last = match.index + match[0].length
  }
  if (last < line.length) {
    const rest = line.slice(last)
    if (rest.includes('|')) {
      const segments = rest.split('|')
      segments.forEach((seg, i) => {
        if (i > 0) parts.push(<span key={`bar-${i}`}>|</span>)
        const trimmed = seg.trim()
        if (/^[\w./-]+$/.test(trimmed) && trimmed.includes('/')) {
          parts.push(<span className={styles.cursorBashPath}>{seg}</span>)
        } else {
          parts.push(seg)
        }
      })
    } else if (/^[\w./-]+$/.test(rest.trim()) && rest.includes('/')) {
      parts.push(<span className={styles.cursorBashPath}>{rest}</span>)
    } else {
      parts.push(rest)
    }
  }

  return parts.length > 0 ? parts : line
}

export function CursorBashOutput({ text }: { text: string }) {
  const lines = useMemo(() => text.split('\n'), [text])

  return (
    <pre className={styles.cursorBashOutput} data-testid="cursor-bash-output">
      {lines.map((line, i) => (
        <span key={i} className={styles.cursorBashLine}>
          {colorizeLine(line)}
          {i < lines.length - 1 ? '\n' : null}
        </span>
      ))}
    </pre>
  )
}
