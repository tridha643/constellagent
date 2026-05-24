import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
import type { OpenPrInfo } from '../../../../shared/github-types'
import {
  filterOpenPrsByHashQuery,
  formatHashMentionInsert,
  parseActiveHashToken,
} from '../../../../shared/composer-hash-mention'

export interface UseConductorComposerHashArgs {
  readonly text: string
  readonly setText: Dispatch<SetStateAction<string>>
  readonly composerRef: RefObject<HTMLTextAreaElement | null>
  readonly repoPath: string
}

export function useConductorComposerHash({
  text,
  setText,
  composerRef,
  repoPath,
}: UseConductorComposerHashArgs) {
  const [cursor, setCursor] = useState(0)
  const [menuIndex, setMenuIndex] = useState(0)
  const [openPrs, setOpenPrs] = useState<readonly OpenPrInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [available, setAvailable] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const hashToken = useMemo(() => parseActiveHashToken(text, cursor), [text, cursor])

  useEffect(() => {
    if (!hashToken || !repoPath) {
      setOpenPrs([])
      setLoading(false)
      setFetchError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setFetchError(null)

    void window.api.github
      .listOpenPrs(repoPath)
      .then((result) => {
        if (cancelled) return
        setAvailable(result.available)
        if (!result.available) {
          setOpenPrs([])
          setFetchError(
            result.error === 'gh_not_installed'
              ? 'Install and authenticate the GitHub CLI (`gh`) to reference pull requests.'
              : result.error === 'not_authenticated'
                ? 'Authenticate the GitHub CLI (`gh auth login`) to reference pull requests.'
                : 'This project is not linked to a GitHub repository.',
          )
          return
        }
        setOpenPrs(result.data)
      })
      .catch(() => {
        if (cancelled) return
        setOpenPrs([])
        setFetchError('Could not load open pull requests.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [hashToken?.from, hashToken?.query, repoPath])

  const filteredPrs = useMemo(() => {
    if (!hashToken) return []
    return filterOpenPrsByHashQuery(openPrs, hashToken.query)
  }, [hashToken, openPrs])

  const showHashMenu = Boolean(hashToken)

  const selectedPr: OpenPrInfo | undefined = showHashMenu
    ? filteredPrs[Math.min(menuIndex, Math.max(filteredPrs.length - 1, 0))]
    : undefined

  useEffect(() => {
    setMenuIndex(0)
  }, [hashToken?.from, hashToken?.query])

  useEffect(() => {
    setMenuIndex((index) => {
      if (filteredPrs.length === 0) return 0
      return Math.min(index, filteredPrs.length - 1)
    })
  }, [filteredPrs.length])

  const replaceRange = useCallback(
    (from: number, to: number, insert: string) => {
      setText((prev) => {
        const next = prev.slice(0, from) + insert + prev.slice(to)
        const pos = from + insert.length
        requestAnimationFrame(() => {
          const el = composerRef.current
          if (el) {
            el.focus()
            el.selectionStart = el.selectionEnd = pos
            setCursor(pos)
          }
        })
        return next
      })
    },
    [setText, composerRef],
  )

  const clearHashToken = useCallback(() => {
    if (!hashToken) return
    replaceRange(hashToken.from, hashToken.to, '')
  }, [hashToken, replaceRange])

  const dismissHashUi = useCallback(() => {
    clearHashToken()
  }, [clearHashToken])

  const applyHashMention = useCallback(
    (pr: OpenPrInfo) => {
      if (!hashToken) return
      replaceRange(hashToken.from, hashToken.to, formatHashMentionInsert(pr))
    },
    [hashToken, replaceRange],
  )

  const onComposerSelectionChange = useCallback((pos: number) => {
    setCursor(pos)
  }, [])

  const wrapComposerKeyDown = useCallback(
    (base: (event: KeyboardEvent<HTMLTextAreaElement>) => void) =>
      (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (showHashMenu) {
          if (filteredPrs.length > 0) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setMenuIndex((index) => (index + 1) % filteredPrs.length)
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setMenuIndex((index) => (index - 1 + filteredPrs.length) % filteredPrs.length)
              return
            }
            if (event.key === 'Tab' && event.shiftKey) {
              event.preventDefault()
              setMenuIndex((index) => (index - 1 + filteredPrs.length) % filteredPrs.length)
              return
            }
            if (event.key === 'Tab' && !event.shiftKey) {
              event.preventDefault()
              setMenuIndex((index) => (index + 1) % filteredPrs.length)
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              const pr = filteredPrs[menuIndex]
              if (pr) applyHashMention(pr)
              return
            }
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            dismissHashUi()
            return
          }
        }

        base(event)
      },
    [showHashMenu, filteredPrs, menuIndex, applyHashMention, dismissHashUi],
  )

  return {
    showHashMenu,
    filteredPrs,
    selectedPr,
    loading,
    available,
    fetchError,
    onSelectHashMention: applyHashMention,
    onComposerSelectionChange,
    wrapComposerKeyDown,
    dismissHashUi,
  }
}
