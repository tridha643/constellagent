import { describe, expect, it } from 'bun:test'
import type { SessionDriver, SessionDriverEvent } from '@pi-gui/session-driver'
import { createPiSdkDriver, PiSdkDriver } from '@pi-gui/pi-sdk-driver'
import type { CatalogStore } from '@pi-gui/catalogs'
import { getAssistantStreamMessageId } from '../../renderer/pi-gui/transcript-stream'
import { hasExtensionDockContent } from '../../renderer/pi-gui/extension-session-ui'
import { segmentMessageForInlineChips } from '../../renderer/pi-gui/message-inline-segments'

describe('vendored @pi-gui/* exports', () => {
  it('session-driver exposes sessionKey without pulling pi-sdk-driver', async () => {
    const { sessionKey } = await import('@pi-gui/session-driver')
    expect(sessionKey({ workspaceId: 'w1', sessionId: 's1' })).toBe('w1:s1')
  })

  it('session-driver exposes core session types', () => {
    const event: SessionDriverEvent = { type: 'session.opened', sessionId: 's1', workspaceId: 'w1' }
    expect(event.type).toBe('session.opened')
    const driverShape: Pick<SessionDriver, 'createSession'> | null = null
    expect(driverShape).toBeNull()
  })

  it('pi-sdk-driver exports driver factory and class', () => {
    expect(typeof createPiSdkDriver).toBe('function')
    expect(PiSdkDriver).toBeDefined()
  })

  it('catalogs exports CatalogStore type surface', () => {
    const storeShape: Pick<CatalogStore, 'list'> | null = null
    expect(storeShape).toBeNull()
  })
})

describe('Conductor pi-gui renderer slices', () => {
  it('transcript-stream resolves streaming assistant id', () => {
    const id = getAssistantStreamMessageId(
      [
        { kind: 'message', id: 'u1', role: 'user', text: 'hi', createdAt: '2026-01-01T00:00:00.000Z' },
        { kind: 'message', id: 'a1', role: 'assistant', text: 'hello', createdAt: '2026-01-01T00:00:01.000Z' },
      ],
      true,
    )
    expect(id).toBe('a1')
  })

  it('extension-session-ui reports empty dock without ui state', () => {
    expect(hasExtensionDockContent(undefined)).toBe(false)
  })

  it('message-inline-segments still segments file paths for Conductor user messages', () => {
    const segments = segmentMessageForInlineChips('See src/main/pi-host-service.ts for details.')
    expect(segments.some((s) => s.kind === 'file')).toBe(true)
  })
})
