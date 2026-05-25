import { describe, expect, mock, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const documentsRoot = join(tmpdir(), `constellagent-project-test-${Date.now()}`)

mock.module('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'documents' ? documentsRoot : join(documentsRoot, name)),
    isPackaged: false,
  },
}))

const {
  createRootlessChatRoot,
  handleMobileProjectMethod,
  isMobileProjectMethod,
  __testing,
} = await import('./mobile-project-folders')

describe('mobile project folders', () => {
  test('isMobileProjectMethod recognizes project RPC namespace', () => {
    expect(isMobileProjectMethod('project/createRootlessChatRoot')).toBe(true)
    expect(isMobileProjectMethod('session.start')).toBe(false)
  })

  test('createRootlessChatRoot creates dated slug directory under Constellagent home', async () => {
    const path = await createRootlessChatRoot('Fix mobile bridge streaming')
    expect(path.startsWith(join(__testing.resolveConstellagentHome()))).toBe(true)
    expect(path).toContain(new Date().toISOString().slice(0, 10))
    expect(path.endsWith('fix-mobile-bridge-streaming')).toBe(true)
  })

  test('handleMobileProjectMethod serves quickLocations and projectlessRoots', async () => {
    const quick = await handleMobileProjectMethod('project/quickLocations', {}) as {
      locations: Array<{ id: string; path: string }>
    }
    expect(quick.locations.some((entry) => entry.id === 'constellagent-home')).toBe(true)

    const roots = await handleMobileProjectMethod('project/projectlessRoots', {}) as {
      roots: string[]
      constellagentHome: string
    }
    expect(roots.roots).toContain(roots.constellagentHome)
  })

  test('handleMobileProjectMethod creates directories on demand', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'constellagent-parent-'))
    try {
      const created = await handleMobileProjectMethod('project/createDirectory', {
        parentPath: parent,
        name: 'nested-chat',
      }) as { path: string }
      expect(created.path).toBe(join(parent, 'nested-chat'))
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})
