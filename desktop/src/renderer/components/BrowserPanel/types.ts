import type { BrowserDomContext } from '../../store/types'

export interface BrowserPickEvent {
  __spideySense: 'pick' | 'cancel'
  payload?: BrowserDomContext
}

export interface BrowserCapturedItem extends BrowserDomContext {
  id: string
  capturedAt: number
}
