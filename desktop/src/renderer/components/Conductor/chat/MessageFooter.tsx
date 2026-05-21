import { useCallback, useEffect, useRef, useState } from 'react'
import { IconSwap } from '../../ui/icon-swap'
import { CheckIcon, CopyIcon, ForkIcon } from './ConductorIcons'
import styles from '../Conductor.module.css'

export function MessageFooter({
  copyText,
  onFork,
  forkDisabled,
  durationLabel,
}: {
  copyText: string
  onFork: () => void
  forkDisabled?: boolean
  durationLabel?: string
}) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const resetCopiedRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const resetFailedRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const handleCopy = useCallback(() => {
    if (!copyText.trim()) return
    void navigator.clipboard
      .writeText(copyText)
      .then(() => {
        if (resetCopiedRef.current !== undefined) clearTimeout(resetCopiedRef.current)
        if (resetFailedRef.current !== undefined) clearTimeout(resetFailedRef.current)
        setCopyFailed(false)
        setCopied(true)
        resetCopiedRef.current = setTimeout(() => {
          setCopied(false)
          resetCopiedRef.current = undefined
        }, 1400)
      })
      .catch(() => {
        setCopied(false)
        setCopyFailed(true)
        if (resetFailedRef.current !== undefined) clearTimeout(resetFailedRef.current)
        resetFailedRef.current = setTimeout(() => {
          setCopyFailed(false)
          resetFailedRef.current = undefined
        }, 1400)
      })
  }, [copyText])

  useEffect(() => {
    return () => {
      if (resetCopiedRef.current !== undefined) clearTimeout(resetCopiedRef.current)
      if (resetFailedRef.current !== undefined) clearTimeout(resetFailedRef.current)
    }
  }, [])

  return (
    <div className={styles.messageFooter}>
      <button
        type="button"
        className={`${styles.messageFooterBtn} ${copied ? styles.messageFooterBtnCopied : ''} ${copyFailed ? styles.messageFooterBtnFailed : ''}`}
        aria-label={copied ? 'Copied to clipboard' : copyFailed ? 'Copy failed' : 'Copy message'}
        onClick={handleCopy}
        disabled={!copyText.trim()}
      >
        <IconSwap active={copied} a={<CheckIcon />} b={<CopyIcon />} size={14} variant="soft" />
      </button>
      {durationLabel && (
        <span className={styles.messageFooterDuration}>
          {durationLabel} <span aria-hidden>·</span>
        </span>
      )}
      <button
        type="button"
        className={styles.messageFooterBtn}
        aria-label="Fork chat from here"
        onClick={onFork}
        disabled={forkDisabled}
      >
        <ForkIcon />
      </button>
    </div>
  )
}
