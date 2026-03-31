import { useAppStore } from '../../store/app-store'
import styles from './ContextWindowIndicator.module.css'

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}

function getColor(percentage: number): string {
  if (percentage >= 80) return 'var(--accent-red)'
  if (percentage >= 60) return 'var(--accent-yellow)'
  return 'var(--accent-green)'
}

const SIZE = 32
const STROKE = 3
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function ContextWindowIndicator() {
  const data = useAppStore((s) => s.contextWindowData)

  if (!data) return null

  const offset = CIRCUMFERENCE - (data.percentage / 100) * CIRCUMFERENCE
  const color = getColor(data.percentage)
  const usedLabel = formatTokens(data.usedTokens)
  const totalLabel = formatTokens(data.contextWindowSize)

  return (
    <div className={styles.container}>
      <svg
        className={styles.ring}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
      >
        <circle
          className={styles.trackCircle}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
        />
        <circle
          className={styles.arcCircle}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          stroke={color}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
        <text
          className={styles.centerText}
          x={SIZE / 2}
          y={SIZE / 2}
        >
          {usedLabel}
        </text>
      </svg>
      <span className={styles.label}>
        {usedLabel} / {totalLabel}
      </span>
      <div className={styles.tooltip}>
        Context window: {usedLabel} / {totalLabel} ({data.percentage}%) — Claude Code
      </div>
    </div>
  )
}
