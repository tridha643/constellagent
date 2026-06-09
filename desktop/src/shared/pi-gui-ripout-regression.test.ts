import { describe, expect, it } from 'bun:test'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { IPC } from './ipc-channels'

/** Pi Thread panel IPC — removed in pi-gui rip-out; Conductor uses agent-chat:* instead. */
const LEGACY_PI_THREAD_CHANNELS = [
  'pi:get-state',
  'pi:sync-workspace',
  'pi:create-session',
  'pi:select-session',
  'pi:submit',
  'pi:cancel',
  'pi:set-model',
  'pi:replace-queue',
  'pi:respond-host-ui',
  'pi:extension-tui-input',
  'pi:state-changed',
  'pi:selected-transcript-changed',
  'pi:list-sessions',
  'pi:delete-session',
  'pi:pick-attachments',
  'pi:set-thinking-level',
  'pi:set-plan',
] as const

describe('pi-gui rip-out IPC regression', () => {
  it('does not expose legacy Pi Thread renderer channels', () => {
    const channelValues = new Set(Object.values(IPC))
    for (const legacy of LEGACY_PI_THREAD_CHANNELS) {
      expect(channelValues.has(legacy)).toBe(false)
    }
  })

  it('keeps Conductor Pi host UI channels on agentChat', () => {
    expect(IPC.AGENT_CHAT_RESPOND_PI_HOST_UI).toBe('agent-chat:respond-pi-host-ui')
    expect(IPC.AGENT_CHAT_PI_EXTENSION_TUI_INPUT).toBe('agent-chat:pi-extension-tui-input')
    expect(IPC.AGENT_CHAT_LIST_PI_MODELS).toBe('agent-chat:list-pi-models')
  })

  it('keeps Pi out of the main entry chunk after production build', () => {
    const mainEntry = resolve(import.meta.dir, '../../out/main/index.js')
    if (!existsSync(mainEntry)) return
    const bytes = statSync(mainEntry).size
    // Pi stack is lazy-loaded into separate chunks; main entry should stay ~1 MB, not ~8 MB.
    expect(bytes).toBeLessThan(1_500_000)
  })
})
