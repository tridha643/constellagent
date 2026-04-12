import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '../../store/app-store'
import type { Toast } from '../../store/types'
import styles from './Toast.module.css'

const EXIT_MS = 160
const AUTO_DISMISS_MS = 5000

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useAppStore((s) => s.dismissToast)
  const [mounted, setMounted] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [documentHidden, setDocumentHidden] = useState(() => document.hidden)
  const timerRef = useRef<number | null>(null)
  const exitTimerRef = useRef<number | null>(null)
  const remainingRef = useRef(AUTO_DISMISS_MS)
  const startedAtRef = useRef(0)

  const clearDismissTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startExit = useCallback(() => {
    if (exiting) return
    clearDismissTimer()
    setExiting(true)
    exitTimerRef.current = window.setTimeout(() => dismissToast(toast.id), EXIT_MS)
  }, [clearDismissTimer, dismissToast, exiting, toast.id])

  const pauseDismiss = useCallback(() => {
    if (exiting || timerRef.current === null) return
    const elapsed = Date.now() - startedAtRef.current
    remainingRef.current = Math.max(0, remainingRef.current - elapsed)
    clearDismissTimer()
  }, [clearDismissTimer, exiting])

  const resumeDismiss = useCallback(() => {
    if (exiting) return
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
  }, [clearDismissTimer, exiting, startExit])

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

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
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current)
  }, [clearDismissTimer])

  return (
    <div
      className={`${styles.toast} ${styles[toast.type]}`}
      data-mounted={mounted}
      data-exiting={exiting}
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
