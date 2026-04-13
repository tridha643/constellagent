import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './GraphiteStackBranchDialog.module.css'

export interface GraphiteStackBranchDialogProps {
  open: boolean
  title: string
  helperText: string
  loading: boolean
  onCancel: () => void
  onConfirm: (branchName: string) => void
}

export function GraphiteStackBranchDialog({
  open,
  title,
  helperText,
  loading,
  onCancel,
  onConfirm,
}: GraphiteStackBranchDialogProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setValue('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const submit = useCallback(() => {
    if (loading) return
    const trimmed = value.trim()
    if (!trimmed) return
    onConfirm(trimmed)
  }, [loading, onConfirm, value])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (loading) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loading, onCancel, open, submit])

  if (!open) return null

  return createPortal(
    (
      <div className={styles.overlay} onClick={loading ? undefined : onCancel}>
        <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
          <div className={styles.title}>{title}</div>
          <p className={styles.helper}>{helperText}</p>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="feature/my-stack-branch"
            value={value}
            disabled={loading}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Stack branch name"
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.confirmBtn} ${loading ? styles.btnLoading : ''}`}
              onClick={submit}
              disabled={loading || !value.trim()}
            >
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    ),
    document.body,
  )
}
