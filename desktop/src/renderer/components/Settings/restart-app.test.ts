import { describe, expect, it } from 'bun:test'
import type { Tab } from '../../store/types'
import { hasUnsavedFilesForRestart, shouldConfirmAppRestart } from './restart-app'

const baseFileTab: Extract<Tab, { type: 'file' }> = {
  id: 'file-tab',
  workspaceId: 'ws-1',
  type: 'file',
  filePath: '/tmp/demo.ts',
}

describe('restart-app helpers', () => {
  it('detects unsaved file tabs', () => {
    expect(hasUnsavedFilesForRestart([
      { ...baseFileTab, unsaved: false },
      { ...baseFileTab, id: 'file-tab-2', unsaved: true },
    ])).toBe(true)
  })

  it('ignores terminals and saved files when checking restart confirmation', () => {
    expect(shouldConfirmAppRestart(true, [
      {
        id: 'term-1',
        workspaceId: 'ws-1',
        type: 'terminal',
        title: 'Terminal 1',
        ptyId: 'pty-1',
      },
      { ...baseFileTab, unsaved: false },
    ])).toBe(false)
  })

  it('skips confirmation when confirm-on-close is disabled', () => {
    expect(shouldConfirmAppRestart(false, [
      { ...baseFileTab, unsaved: true },
    ])).toBe(false)
  })
})
