import { useCallback, useEffect, useRef, useState } from 'react'
import { useExitAnimation } from '../../hooks/useExitAnimation'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import styles from './ConfirmDialog.module.css'

interface Props {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  destructive?: boolean
  tip?: string
  loading?: boolean
  confirmInPlace?: boolean
  secondaryConfirmLabel?: string
  onSecondaryConfirm?: () => void
}

/** Match `constellagent-dialog-*--exiting` duration (`--duration-exit` in design-tokens). */
const EXIT_MS = 140

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel, destructive = false, tip, loading = false, confirmInPlace = false, secondaryConfirmLabel, onSecondaryConfirm }: Props) {
  const [open, setOpen] = useState(true)
  const { shouldRender, animating } = useExitAnimation(open, EXIT_MS)
  const pendingRef = useRef<(() => void) | null>(null)
  const inPlacePendingRef = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const exiting = animating === 'exit'

  // Trap Tab focus inside the dialog so keyboard nav can't reach the obscured app.
  useFocusTrap(dialogRef, shouldRender)

  useEffect(() => {
    if (!loading) inPlacePendingRef.current = false
  }, [loading])

  const beginExit = useCallback((cb: () => void) => {
    if (loading || exiting) return
    pendingRef.current = cb
    setOpen(false)
  }, [loading, exiting])

  useEffect(() => {
    if (!shouldRender && pendingRef.current) {
      const fn = pendingRef.current
      pendingRef.current = null
      fn()
    }
  }, [shouldRender])

  const handleCancel = useCallback(() => {
    if (loading) return
    beginExit(onCancel)
  }, [loading, beginExit, onCancel])

  const handleConfirm = useCallback(() => {
    if (loading) return
    if (confirmInPlace) {
      if (inPlacePendingRef.current) return
      inPlacePendingRef.current = true
      onConfirm()
      return
    }
    beginExit(onConfirm)
  }, [loading, confirmInPlace, beginExit, onConfirm])

  const handleSecondary = useCallback(() => {
    if (loading || !onSecondaryConfirm) return
    beginExit(onSecondaryConfirm)
  }, [loading, beginExit, onSecondaryConfirm])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (loading || exiting) return
    if (e.key === 'Escape') handleCancel()
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirm()
    }
  }, [handleConfirm, handleCancel, loading, exiting])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const btnClass = destructive ? styles.destructiveBtn : styles.confirmBtn

  if (!shouldRender) {
    return null
  }

  return (
    <div
      className={`${styles.overlay} constellagent-dialog-overlay ${exiting ? 'constellagent-dialog-overlay--exiting' : ''}`}
      onClick={loading ? undefined : handleCancel}
    >
      <div
        ref={dialogRef}
        className={`${styles.dialog} constellagent-dialog-body ${exiting ? 'constellagent-dialog-body--exiting' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.title}>{title}</div>
        <div className={styles.message}>{message}</div>
        {tip && <div className={styles.tip}>{tip}</div>}
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={handleCancel} disabled={loading || exiting}>Cancel</button>
          {secondaryConfirmLabel && onSecondaryConfirm && (
            <button
              className={`${styles.secondaryBtn} ${loading ? styles.btnLoading : ''}`}
              onClick={handleSecondary}
              disabled={loading || exiting}
            >
              {secondaryConfirmLabel}
            </button>
          )}
          <button
            className={`${btnClass} ${loading ? styles.btnLoading : ''}`}
            onClick={handleConfirm}
            autoFocus
            disabled={loading || exiting}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
