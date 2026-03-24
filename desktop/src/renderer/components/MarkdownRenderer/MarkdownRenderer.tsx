import { Streamdown } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { mermaid } from '@streamdown/mermaid'
import { math } from '@streamdown/math'
import { cjk } from '@streamdown/cjk'
import styles from './MarkdownRenderer.module.css'

/** Dark-friendly Shiki themes for code blocks (Streamdown uses [light, dark] tuple). */
const code = createCodePlugin({
  themes: ['github-dark', 'github-dark'],
})

interface Props {
  children: string
  isStreaming?: boolean
  className?: string
}

export function MarkdownRenderer({ children, isStreaming, className }: Props) {
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
            themeVariables: {
              primaryColor: '#7B93BD',
              primaryTextColor: '#eeeeee',
              primaryBorderColor: '#2e2e2e',
              lineColor: '#999999',
              secondaryColor: '#88C0D0',
              tertiaryColor: '#B48EAD',
            },
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
