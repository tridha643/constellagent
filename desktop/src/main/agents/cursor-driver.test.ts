import { describe, expect, it, mock } from 'bun:test'

mock.module('../cursor-sdk-interaction-config', () => ({}))

const {
  buildCursorUserMessage,
  isBenignConnectTransportError,
  isBenignCursorRunError,
} = await import('./cursor-driver')

describe('isBenignCursorRunError', () => {
  it('treats aborted signals as benign', () => {
    const controller = new AbortController()
    controller.abort()
    expect(isBenignCursorRunError(new Error('anything'), controller.signal)).toBe(true)
  })

  it('treats Connect canceled codes as benign', () => {
    const controller = new AbortController()
    const err = Object.assign(new Error('canceled'), { code: 1 })
    expect(isBenignCursorRunError(err, controller.signal)).toBe(true)
  })

  it('does not treat unknown connect errors as benign when not aborted', () => {
    const controller = new AbortController()
    const err = Object.assign(new Error('[unknown] Error'), { code: 2 })
    expect(isBenignCursorRunError(err, controller.signal)).toBe(false)
  })
})

describe('isBenignConnectTransportError', () => {
  it('treats Connect unknown teardown errors as benign', () => {
    const err = Object.assign(new Error('[unknown] Error'), { code: 2 })
    expect(isBenignConnectTransportError(err)).toBe(true)
  })

  it('does not treat unrelated errors as benign', () => {
    expect(isBenignConnectTransportError(new Error('network down'))).toBe(false)
  })
})

describe('buildCursorUserMessage', () => {
  it('returns plain text when no attachments exist', () => {
    expect(buildCursorUserMessage('hello', [])).toBe('hello')
  })

  it('returns SDK user message with images', () => {
    expect(
      buildCursorUserMessage('look', [
        {
          id: 'image-1',
          kind: 'image',
          name: 'screenshot.png',
          mimeType: 'image/png',
          data: 'aW1hZ2U=',
        },
      ]),
    ).toEqual({
      text: 'look',
      images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }],
    })
  })
})
