import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LoaderProps } from '@/lib/loader-props'
import { Attention } from '@/components/ui/attention'
import { Backprop } from '@/components/ui/backprop'
import { Bloom } from '@/components/ui/bloom'
import { Compile } from '@/components/ui/compile'
import { Drift } from '@/components/ui/drift'
import { GradientDescent } from '@/components/ui/gradient-descent'
import { Helix } from '@/components/ui/helix'
import { TokenStream } from '@/components/ui/token-stream'
import { VectorIndex } from '@/components/ui/vector-index'
import { Webhook } from '@/components/ui/webhook'
import {
  PATTERN_CSS_CROSS,
  PATTERN_CSS_DIAMOND,
  PATTERN_CSS_OUTLINE,
  PATTERN_CSS_RINGS,
} from './muload-loader-patterns'
import styles from '../Conductor.module.css'

const TICK_MS = 100
const PATTERN_SECONDS = 5
const LOADER_SPEED = 3.5
const LOADER_DOT_SIZE = 2

type LoaderVariant = {
  pattern?: string
  patternCss?: string
  render: (props: LoaderProps) => ReactNode
}

const LOADER_VARIANTS: LoaderVariant[] = [
  { render: (props) => <TokenStream {...props} /> },
  {
    pattern: 'diamond',
    patternCss: PATTERN_CSS_DIAMOND,
    render: (props) => <Attention {...props} />,
  },
  {
    pattern: 'rings',
    patternCss: PATTERN_CSS_RINGS,
    render: (props) => <Backprop {...props} />,
  },
  {
    pattern: 'cross',
    patternCss: PATTERN_CSS_CROSS,
    render: (props) => <Compile {...props} />,
  },
  { render: (props) => <VectorIndex {...props} /> },
  { render: (props) => <Webhook {...props} /> },
  { render: (props) => <GradientDescent {...props} /> },
  { render: (props) => <Bloom {...props} /> },
  {
    pattern: 'outline',
    patternCss: PATTERN_CSS_OUTLINE,
    render: (props) => <Helix {...props} />,
  },
  { render: (props) => <Drift {...props} /> },
]

function formatElapsedSeconds(seconds: number): string {
  return `${seconds.toFixed(1)}s`
}

function PatternFrame({
  pattern,
  patternCss,
  children,
}: {
  pattern: string
  patternCss: string
  children: ReactNode
}) {
  return (
    <>
      <style>{patternCss}</style>
      <div data-pattern={pattern}>{children}</div>
    </>
  )
}

/** Seconds elapsed since `startedAt` (or mount), ticking every TICK_MS. */
function useElapsedSeconds(startedAt?: number | null): number {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const origin = startedAt ?? Date.now()
    const tick = () => setElapsed((Date.now() - origin) / 1000)
    tick()
    const id = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(id)
  }, [startedAt])

  return elapsed
}

function renderVariant(variant: LoaderVariant, loaderProps: LoaderProps): ReactNode {
  return variant.pattern && variant.patternCss ? (
    <PatternFrame pattern={variant.pattern} patternCss={variant.patternCss}>
      {variant.render(loaderProps)}
    </PatternFrame>
  ) : (
    variant.render(loaderProps)
  )
}

/**
 * Just the rotating dot-matrix glyph (no elapsed timer), sized for inline/icon use.
 * Same variant rotation as the Conductor loader — see {@link MuloadLoader}.
 */
export function MuloadGlyph({
  dotSize = LOADER_DOT_SIZE,
  color = 'var(--text-secondary)',
  className,
}: {
  dotSize?: number
  color?: string
  className?: string
}) {
  const elapsed = useElapsedSeconds()
  const variant = LOADER_VARIANTS[Math.floor(elapsed / PATTERN_SECONDS) % LOADER_VARIANTS.length]

  const loaderProps = useMemo<LoaderProps>(
    () => ({ speed: LOADER_SPEED, dotSize, cellPadding: 0.5, color }),
    [dotSize, color],
  )

  return (
    <span className={className} aria-hidden>
      {renderVariant(variant, loaderProps)}
    </span>
  )
}

/** Conductor dot-matrix loader rotation + elapsed timer while a turn is in flight. */
export function MuloadLoader({
  startedAt,
  className,
}: {
  startedAt?: number | null
  className?: string
}) {
  const elapsed = useElapsedSeconds(startedAt)
  const variant = LOADER_VARIANTS[Math.floor(elapsed / PATTERN_SECONDS) % LOADER_VARIANTS.length]

  const loaderProps = useMemo<LoaderProps>(
    () => ({
      speed: LOADER_SPEED,
      dotSize: LOADER_DOT_SIZE,
      cellPadding: 0.5,
      color: 'var(--text-secondary)',
    }),
    [],
  )

  return (
    <span className={`${styles.muloadLoader} ${className ?? ''}`} role="status" aria-live="polite">
      <span className={styles.muloadGlyph} aria-hidden>
        {renderVariant(variant, loaderProps)}
      </span>
      <span className={styles.muloadElapsed}>{formatElapsedSeconds(elapsed)}</span>
    </span>
  )
}
