import { useMemo } from 'react'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { mermaid } from '@streamdown/mermaid'
import { math } from '@streamdown/math'
import { cjk } from '@streamdown/cjk'
import { useAppStore } from '../../store/app-store'
import { getAppearanceMermaidThemeVariables } from '../../theme/appearance'
import styles from './MarkdownRenderer.module.css'

interface Props {
  children: string
  isStreaming?: boolean
  className?: string
}

export function MarkdownRenderer({ children, isStreaming, className }: Props) {
  const appearanceThemeId = useAppStore((s) => s.settings.appearanceThemeId)
  const code = useMemo(() => createCodePlugin({
    themes: ['github-dark', 'github-dark'],
  }), [])
  const mermaidThemeVariables = useMemo(
    () => getAppearanceMermaidThemeVariables(appearanceThemeId),
    [appearanceThemeId],
  )

  return (
    <div className={`${styles.wrapper} ${className ?? ''}`}>
      <Streamdown
        shikiTheme={['github-dark', 'github-dark']}
        plugins={{ code, mermaid, math, cjk }}
        animated={isStreaming}
        isAnimating={isStreaming}
        mermaid={{
          config: {
            theme: 'dark',
            themeVariables: mermaidThemeVariables,
          },
        }}
        controls={{
          mermaid: { fullscreen: true, download: true, copy: true, panZoom: true },
          code: { copy: true, download: true },
          /* Table chrome (copy/download/fullscreen) is disabled — layout was unreliable in our shell */
          table: false,
        }}
      >
        {children}
      </Streamdown>
    </div>
  )
}
