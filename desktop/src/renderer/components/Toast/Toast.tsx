import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '../../store/app-store'
import type { Toast } from '../../store/types'
import { useExitAnimation } from '../../hooks/useExitAnimation'
import styles from './Toast.module.css'

const EXIT_MS = 140
const AUTO_DISMISS_MS = 5000

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useAppStore((s) => s.dismissToast)
  const [visible, setVisible] = useState(true)
  const [entered, setEntered] = useState(false)
  const { shouldRender, animating } = useExitAnimation(visible, EXIT_MS)
  const [hovered, setHovered] = useState(false)
  const [documentHidden, setDocumentHidden] = useState(() => document.hidden)
  const timerRef = useRef<number | null>(null)
  const remainingRef = useRef(AUTO_DISMISS_MS)
  const startedAtRef = useRef(0)

  const clearDismissTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startExit = useCallback(() => {
    if (!visible) return
    clearDismissTimer()
    setVisible(false)
  }, [clearDismissTimer, visible])

  const pauseDismiss = useCallback(() => {
    if (!visible || timerRef.current === null) return
    const elapsed = Date.now() - startedAtRef.current
    remainingRef.current = Math.max(0, remainingRef.current - elapsed)
    clearDismissTimer()
  }, [clearDismissTimer, visible])

  const resumeDismiss = useCallback(() => {
    if (!visible) return
    clearDismissTimer()
    if (remainingRef.current <= 0) {
      startExit()
      return
    }

    startedAtRef.current = Date.now()
    timerRef.current = window.setTimeout(() => {
      remainingRef.current = 0
      startExit()
    }, remainingRef.current)
  }, [clearDismissTimer, visible, startExit])

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (!shouldRender) {
      dismissToast(toast.id)
    }
  }, [shouldRender, dismissToast, toast.id])

  useEffect(() => {
    const handleVisibility = () => setDocumentHidden(document.hidden)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  useEffect(() => {
    if (hovered || documentHidden) pauseDismiss()
    else resumeDismiss()
  }, [documentHidden, hovered, pauseDismiss, resumeDismiss])

  useEffect(() => () => {
    clearDismissTimer()
  }, [clearDismissTimer])

  if (!shouldRender) {
    return null
  }

  return (
    <div
      className={`${styles.toast} ${styles[toast.type]}`}
      data-mounted={entered && animating !== 'exit'}
      data-exiting={animating === 'exit'}
      onClick={startExit}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={styles.message}>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className={styles.actionBtn}
          onClick={(e) => {
            e.stopPropagation()
            toast.action!.onClick()
            startExit()
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}

export function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts)
  if (toasts.length === 0) return null

  return (
    <div className={styles.container}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
