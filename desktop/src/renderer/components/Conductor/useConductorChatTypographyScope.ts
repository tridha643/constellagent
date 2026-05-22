import { useLayoutEffect, type RefObject } from 'react'
import {
  applyConductorChatTypographyToElement,
  clearConductorChatTypographyFromElement,
} from '../../theme/appearance'

/** Pin Default --font-* on a Conductor subtree; semantic colors inherit from :root. */
export function useConductorChatTypographyScope(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    applyConductorChatTypographyToElement(el)
    return () => clearConductorChatTypographyFromElement(el)
  }, [])
}
