import { useCallback, useEffect } from 'react'
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
  secondaryConfirmLabel?: string
  onSecondaryConfirm?: () => void
}

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel, destructive = false, tip, loading = false, secondaryConfirmLabel, onSecondaryConfirm }: Props) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (loading) return
    if (e.key === 'Escape') onCancel()
    if (e.key === 'Enter') {
      e.preventDefault()
      onConfirm()
    }
  }, [onConfirm, onCancel, loading])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const btnClass = destructive ? styles.destructiveBtn : styles.confirmBtn

  return (
    <div className={styles.overlay} onClick={loading ? undefined : onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>{title}</div>
        <div className={styles.message}>{message}</div>
        {tip && <div className={styles.tip}>{tip}</div>}
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel} disabled={loading}>Cancel</button>
          {secondaryConfirmLabel && onSecondaryConfirm && (
            <button
              className={`${styles.secondaryBtn} ${loading ? styles.btnLoading : ''}`}
              onClick={onSecondaryConfirm}
              disabled={loading}
            >
              {secondaryConfirmLabel}
            </button>
          )}
          <button
            className={`${btnClass} ${loading ? styles.btnLoading : ''}`}
            onClick={onConfirm}
            autoFocus
            disabled={loading}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
