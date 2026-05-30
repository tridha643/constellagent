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
import {
  atMentionSearchQuery,
  formatAtMentionInsert,
  parseActiveAtToken,
} from '../../../../shared/composer-at-mention'
import type { QuickOpenSearchItem } from '../../../../shared/quick-open-types'
import type { ComposerDraftInputRef } from './composer-draft-input-ref'

const AT_MENTION_LIMIT = 25
const AT_SEARCH_DEBOUNCE_MS = 80

export interface UseConductorComposerAtArgs {
  readonly text: string
  readonly setText: Dispatch<SetStateAction<string>>
  readonly composerRef: RefObject<ComposerDraftInputRef | null>
  readonly workspacePath: string
}

export function useConductorComposerAt({
  text,
  setText,
  composerRef,
  workspacePath,
}: UseConductorComposerAtArgs) {
  const [cursor, setCursor] = useState(0)
  const [menuIndex, setMenuIndex] = useState(0)
  const [items, setItems] = useState<readonly QuickOpenSearchItem[]>([])
  const [loading, setLoading] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const atToken = useMemo(() => parseActiveAtToken(text, cursor), [text, cursor])

  useEffect(() => {
    if (!atToken || !workspacePath) {
      setItems([])
      setLoading(false)
      setIndexing(false)
      setFetchError(null)
      return
    }

    let cancelled = false
    const query = atMentionSearchQuery(atToken.query)
    setLoading(true)
    setFetchError(null)

    const timer = window.setTimeout(() => {
      void window.api.fs
        .quickOpenSearch(workspacePath, { query, limit: AT_MENTION_LIMIT })
        .then((result) => {
          if (cancelled) return
          setIndexing(result.state === 'indexing')
          if (result.state === 'error') {
            setItems([])
            setFetchError(result.error ?? 'Could not search workspace files.')
            return
          }
          setItems(result.items)
        })
        .catch(() => {
          if (cancelled) return
          setItems([])
          setFetchError('Could not search workspace files.')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, AT_SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [atToken?.from, atToken?.query, workspacePath])

  const showAtMenu = Boolean(atToken)

  const selectedItem: QuickOpenSearchItem | undefined = showAtMenu
    ? items[Math.min(menuIndex, Math.max(items.length - 1, 0))]
    : undefined

  useEffect(() => {
    setMenuIndex(0)
  }, [atToken?.from, atToken?.query])

  useEffect(() => {
    setMenuIndex((index) => {
      if (items.length === 0) return 0
      return Math.min(index, items.length - 1)
    })
  }, [items.length])

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

  const clearAtToken = useCallback(() => {
    if (!atToken) return
    replaceRange(atToken.from, atToken.to, '')
  }, [atToken, replaceRange])

  const dismissAtUi = useCallback(() => {
    clearAtToken()
  }, [clearAtToken])

  const applyAtMention = useCallback(
    (item: QuickOpenSearchItem) => {
      if (!atToken) return
      replaceRange(atToken.from, atToken.to, formatAtMentionInsert(item))
    },
    [atToken, replaceRange],
  )

  const onComposerSelectionChange = useCallback((pos: number) => {
    setCursor(pos)
  }, [])

  const wrapComposerKeyDown = useCallback(
    (base: (event: KeyboardEvent<HTMLElement>) => void) =>
      (event: KeyboardEvent<HTMLElement>) => {
        if (showAtMenu) {
          if (items.length > 0) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setMenuIndex((index) => (index + 1) % items.length)
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setMenuIndex((index) => (index - 1 + items.length) % items.length)
              return
            }
            if (event.key === 'Tab' && event.shiftKey) {
              event.preventDefault()
              setMenuIndex((index) => (index - 1 + items.length) % items.length)
              return
            }
            if (event.key === 'Tab' && !event.shiftKey) {
              event.preventDefault()
              setMenuIndex((index) => (index + 1) % items.length)
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              const item = items[menuIndex]
              if (item) applyAtMention(item)
              return
            }
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            dismissAtUi()
            return
          }
        }

        base(event)
      },
    [showAtMenu, items, menuIndex, applyAtMention, dismissAtUi],
  )

  return {
    showAtMenu,
    atItems: items,
    selectedAtItem: selectedItem,
    loading,
    indexing,
    fetchError,
    onSelectAtMention: applyAtMention,
    onComposerSelectionChange,
    wrapComposerKeyDown,
    dismissAtUi,
  }
}
