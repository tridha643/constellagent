import type { ReactNode } from 'react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { indicatorMetrics, type IndicatorMetrics, type TabBox } from './sliding-tabs-geometry'
import styles from './SlidingTabs.module.css'

export interface SlidingTab {
  id: string
  label: string
  icon?: ReactNode
}

export interface SlidingTabsProps {
  tabs: SlidingTab[]
  activeId: string
  onChange: (id: string) => void
  /** Accessible label for the tablist. */
  ariaLabel: string
  className?: string
  'data-testid'?: string
}

/**
 * Tabs with a measured sliding-indicator pill (rudu `Tabs.Indicator` port).
 *
 * Unlike `SegmentedPill` (which just repaints the active well), the pill here
 * physically slides — `translateX` + `width` retarget the active tab over
 * 200ms `--ease-in-out`. The geometry is measured from the live DOM and the
 * math lives in `sliding-tabs-geometry.ts`. Reduced motion drops the slide
 * (the pill jumps) while keeping the active highlight; see the module CSS.
 */
export function SlidingTabs({
  tabs,
  activeId,
  onChange,
  ariaLabel,
  className,
  'data-testid': testId,
}: SlidingTabsProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [metrics, setMetrics] = useState<IndicatorMetrics | null>(null)

  const measure = useCallback(() => {
    const boxes: TabBox[] = tabs.map((tab) => {
      const el = tabRefs.current.get(tab.id)
      return { offsetLeft: el?.offsetLeft ?? 0, offsetWidth: el?.offsetWidth ?? 0 }
    })
    const activeIndex = tabs.findIndex((tab) => tab.id === activeId)
    setMetrics(indicatorMetrics(boxes, activeIndex))
  }, [tabs, activeId])

  // Measure after layout so offsetLeft/Width reflect the painted sizes, and
  // re-measure whenever the track resizes (font load, container width change).
  useLayoutEffect(() => {
    measure()
    const track = trackRef.current
    if (!track || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(track)
    return () => ro.disconnect()
  }, [measure])

  return (
    <div
      ref={trackRef}
      className={[styles.track, className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <span
        aria-hidden
        className={`${styles.indicator} ${metrics ? '' : styles.indicatorHidden}`}
        style={
          metrics
            ? ({
                '--indicator-x': `${metrics.x}px`,
                '--indicator-width': `${metrics.width}px`,
              } as React.CSSProperties)
            : undefined
        }
      />
      {tabs.map((tab) => {
        const isActive = tab.id === activeId
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) tabRefs.current.set(tab.id, el)
              else tabRefs.current.delete(tab.id)
            }}
            type="button"
            role="tab"
            id={`sliding-tab-${tab.id}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon ? <span className={styles.icon}>{tab.icon}</span> : null}
            <span className={styles.label}>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
