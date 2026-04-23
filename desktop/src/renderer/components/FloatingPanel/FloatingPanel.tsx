import { forwardRef } from 'react'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import styles from './FloatingPanel.module.css'

export type FloatingPanelVariant = 'fullscreen' | 'drawer'

interface FloatingPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: FloatingPanelVariant
  children: ReactNode
  /** Sets data-testid on the floating card itself so e2e selectors can stay
   *  anchored to the same element even after the surrounding shell changed. */
  testId?: string
  /** Extra class on the inner .card element (border, padding tweaks, etc.). */
  cardClassName?: string
  /** Optional inline style forwarded to the shell (used by HunkReview to drive
   *  drawer width while preserving the floating inset). */
  shellStyle?: CSSProperties
  /** Extra class on the outer .shell wrapper. */
  shellClassName?: string
}

/**
 * Shared floating-card shell used by every full-layout panel (Settings,
 * Linear, Automations) and the HunkReview drawer. Mirrors `SidePanelHost.host`
 * chrome so the language stays consistent across the app.
 *
 * Forwarded ref targets the inner `.card` element so consumers can call
 * `.focus()` / `.scrollIntoView()` on the element that actually owns the
 * dialog role.
 */
type FloatingPanelComponent = ReturnType<typeof forwardRef<HTMLDivElement, FloatingPanelProps>> & {
  Titlebar: typeof Titlebar
  Body: typeof Body
  Surface: typeof Surface
}

export const FloatingPanel = forwardRef<HTMLDivElement, FloatingPanelProps>(function FloatingPanel(
  {
    variant = 'fullscreen',
    children,
    testId,
    cardClassName,
    shellClassName,
    shellStyle,
    className,
    tabIndex,
    role,
    'aria-modal': ariaModal,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const shellVariantClass = variant === 'drawer' ? styles.drawer : styles.fullscreen
  return (
    <div
      className={[styles.shell, shellVariantClass, shellClassName, className]
        .filter(Boolean)
        .join(' ')}
      style={shellStyle}
      {...rest}
    >
      <div
        className={[styles.card, cardClassName].filter(Boolean).join(' ')}
        data-testid={testId}
        ref={ref}
        tabIndex={tabIndex}
        role={role}
        aria-modal={ariaModal}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  )
}) as FloatingPanelComponent

interface TitlebarProps extends HTMLAttributes<HTMLDivElement> {
  trafficLightPad?: boolean
  children?: ReactNode
}

/** Drag strip that clears the titlebar height. Pass `trafficLightPad` on the
 *  side of the app where macOS traffic lights sit (left on hiddenInset). */
function Titlebar({ trafficLightPad, children, className, ...rest }: TitlebarProps) {
  return (
    <div
      className={[
        styles.titlebar,
        trafficLightPad ? styles.titlebarTrafficLightPad : undefined,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  )
}

interface BodyProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

/** Flex/scroll container for the content beneath the titlebar. */
function Body({ children, className, ...rest }: BodyProps) {
  return (
    <div
      className={[styles.body, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </div>
  )
}

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

/** Quiet floating-card variant without a titlebar; used for the welcome
 *  state and other standalone lifts that shouldn't read as app chrome. */
function Surface({ children, className, ...rest }: SurfaceProps) {
  return (
    <div
      className={[styles.surface, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </div>
  )
}

FloatingPanel.Titlebar = Titlebar
FloatingPanel.Body = Body
FloatingPanel.Surface = Surface

export type { FloatingPanelProps }
