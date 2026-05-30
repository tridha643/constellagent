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
import type { GithubLookupError, OpenPrInfo } from '../../../../shared/github-types'
import {
  filterOpenPrsByHashQuery,
  formatHashMentionInsert,
  parseActiveHashToken,
} from '../../../../shared/composer-hash-mention'
import {
  getRendererOpenPrListCacheStore,
  getRendererOpenPrListInFlightStore,
  isOpenPrListCacheFresh,
  shouldSkipOpenPrListPrefetch,
  writeRendererOpenPrListCache,
  type OpenPrListCacheEntry,
} from '../../../../shared/open-pr-list-cache'
import type { ComposerDraftInputRef } from './composer-draft-input-ref'

export interface UseConductorComposerHashArgs {
  readonly text: string
  readonly setText: Dispatch<SetStateAction<string>>
  readonly composerRef: RefObject<ComposerDraftInputRef | null>
  readonly repoPath: string
}

function openPrListErrorMessage(error: GithubLookupError | undefined): string | null {
  if (!error) return null
  if (error === 'gh_not_installed') {
    return 'Install and authenticate the GitHub CLI (`gh`) to reference pull requests.'
  }
  if (error === 'not_authenticated') {
    return 'Authenticate the GitHub CLI (`gh auth login`) to reference pull requests.'
  }
  return 'This project is not linked to a GitHub repository.'
}

async function syncOpenPrListCache(repoPath: string): Promise<OpenPrListCacheEntry> {
  const result = await window.api.github.listOpenPrs(repoPath)
  const entry: OpenPrListCacheEntry = {
    fetchedAt: Date.now(),
    available: result.available,
    error: result.available ? null : openPrListErrorMessage(result.error),
    data: result.data,
  }
  if (result.available) {
    writeRendererOpenPrListCache(repoPath, entry)
  }
  return entry
}

function getOrSyncOpenPrListCache(repoPath: string): Promise<OpenPrListCacheEntry> {
  const inFlightSyncByRepo = getRendererOpenPrListInFlightStore()
  const inFlight = inFlightSyncByRepo.get(repoPath)
  if (inFlight) return inFlight

  const promise = syncOpenPrListCache(repoPath).finally(() => {
    inFlightSyncByRepo.delete(repoPath)
  })
  inFlightSyncByRepo.set(repoPath, promise)
  return promise
}

function applyCacheEntry(
  entry: OpenPrListCacheEntry,
  setOpenPrs: Dispatch<SetStateAction<readonly OpenPrInfo[]>>,
  setAvailable: Dispatch<SetStateAction<boolean>>,
  setFetchError: Dispatch<SetStateAction<string | null>>,
): void {
  setAvailable(entry.available)
  setOpenPrs(entry.data)
  setFetchError(entry.error)
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
  const [refreshing, setRefreshing] = useState(false)
  const [available, setAvailable] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const hashToken = useMemo(() => parseActiveHashToken(text, cursor), [text, cursor])
  const hashMenuOpen = Boolean(hashToken)

  useEffect(() => {
    const testWindow = window as Window & {
      __testOpenPrListCacheGet?: (repoPath: string) => OpenPrListCacheEntry | undefined
    }
    testWindow.__testOpenPrListCacheGet = (path: string) =>
      getRendererOpenPrListCacheStore().get(path)
    return () => {
      delete testWindow.__testOpenPrListCacheGet
    }
  }, [])

  useEffect(() => {
    if (!repoPath) return

    const cached = getRendererOpenPrListCacheStore().get(repoPath)
    if (shouldSkipOpenPrListPrefetch(cached)) {
      return
    }

    let cancelled = false
    void getOrSyncOpenPrListCache(repoPath).catch(() => {
      if (cancelled) return
    })

    return () => {
      cancelled = true
    }
  }, [repoPath])

  useEffect(() => {
    if (!hashMenuOpen || !repoPath) {
      setLoading(false)
      setRefreshing(false)
      return
    }

    const cached = getRendererOpenPrListCacheStore().get(repoPath)
    if (cached) {
      applyCacheEntry(cached, setOpenPrs, setAvailable, setFetchError)
      setLoading(false)

      if (isOpenPrListCacheFresh(cached.fetchedAt)) {
        setRefreshing(false)
        return
      }

      let cancelled = false
      setRefreshing(true)
      void getOrSyncOpenPrListCache(repoPath)
        .then((entry) => {
          if (cancelled) return
          applyCacheEntry(entry, setOpenPrs, setAvailable, setFetchError)
        })
        .catch(() => {
          if (cancelled) return
          if (!getRendererOpenPrListCacheStore().get(repoPath)?.data.length) {
            setFetchError('Could not load open pull requests.')
          }
        })
        .finally(() => {
          if (!cancelled) setRefreshing(false)
        })

      return () => {
        cancelled = true
        setRefreshing(false)
      }
    }

    let cancelled = false
    setLoading(true)
    setFetchError(null)
    void getOrSyncOpenPrListCache(repoPath)
      .then((entry) => {
        if (cancelled) return
        applyCacheEntry(entry, setOpenPrs, setAvailable, setFetchError)
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
      setLoading(false)
    }
  }, [hashMenuOpen, repoPath])

  const filteredPrs = useMemo(() => {
    if (!hashToken) return []
    return filterOpenPrsByHashQuery(openPrs, hashToken.query)
  }, [hashToken, openPrs])

  const showHashMenu = hashMenuOpen

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
        const el = composerRef.current
        if (el) {
          el.setSelectionRange(pos, pos)
          el.focus()
          setCursor(pos)
        }
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
    (base: (event: KeyboardEvent<HTMLElement>) => void) =>
      (event: KeyboardEvent<HTMLElement>) => {
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
    refreshing,
    available,
    fetchError,
    onSelectHashMention: applyHashMention,
    onComposerSelectionChange,
    wrapComposerKeyDown,
    dismissHashUi,
  }
}
