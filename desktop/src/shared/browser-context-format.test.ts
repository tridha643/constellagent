import { describe, expect, it } from 'bun:test'
import { formatComponentMutationContext, formatSelectedComponentContext } from './browser-context-format'
import { formatChatContext } from '../renderer/utils/chat-context-formatter'
import type { SelectedComponentContext } from './browser-context-types'
import { validateBrowserSourceLookupRequest } from './browser-source-lookup'

const component: SelectedComponentContext = {
  kind: 'browser-selected-component',
  url: 'http://localhost:3000',
  tag: 'BUTTON',
  text: 'Save changes',
  id: 'save',
  className: 'primary',
  domPath: 'html > body > button#save',
  attributes: { type: 'button', 'data-agent-source-file': 'src/App.tsx' },
  boundingBox: { x: 10, y: 20, width: 100, height: 32 },
  nearbyText: ['Settings'],
  agentMetadata: { file: 'src/App.tsx', line: 12 },
  timestamp: 1,
}

describe('browser context formatting', () => {
  it('formats selected component context', () => {
    const text = formatSelectedComponentContext(component)
    expect(text).toContain('Browser selected component')
    expect(text).toContain('Element: <button id="save" class="primary">')
    expect(text).toContain('Source metadata: src/App.tsx:12')
  })

  it('formats compact mutation context', () => {
    const text = formatComponentMutationContext({
      kind: 'browser-component-mutation',
      mutationType: 'style',
      before: component,
      after: { ...component, text: 'Save now' },
      changedCssProperties: { backgroundColor: '#ff0000' },
      boundingBoxBefore: component.boundingBox,
      boundingBoxAfter: component.boundingBox,
      generatedDelta: 'style.backgroundColor = #ff0000',
      timestamp: 2,
    })
    expect(text).toContain('Browser component style mutation')
    expect(text).toContain('Changed CSS: backgroundColor: #ff0000')
  })

  it('preserves selected UI component identity at the chat formatter boundary', () => {
    const fallbackText = formatSelectedComponentContext(component)
    const text = formatChatContext([{
      text: fallbackText,
      contextItem: {
        type: 'selected-ui-component',
        selectedComponent: component,
        fallbackText,
      },
    }])
    expect(text).toContain('Context item: selected-ui-component')
    expect(text).toContain('Browser selected component')
  })
})

describe('browser source lookup validation', () => {
  it('allows source files inside worktree', () => {
    const plan = validateBrowserSourceLookupRequest({
      worktreePath: 'C:/repo',
      sourceFile: 'src/App.tsx',
      sourceLine: 50,
      radius: 10,
    })
    expect(plan.startLine).toBe(40)
    expect(plan.endLine).toBe(60)
  })

  it('blocks escaped and private paths', () => {
    expect(() => validateBrowserSourceLookupRequest({
      worktreePath: 'C:/repo',
      sourceFile: '../secret.ts',
    })).toThrow()
    expect(() => validateBrowserSourceLookupRequest({
      worktreePath: 'C:/repo',
      sourceFile: 'node_modules/pkg/index.js',
    })).toThrow()
    expect(() => validateBrowserSourceLookupRequest({
      worktreePath: 'C:/repo',
      sourceFile: '.env.local',
    })).toThrow()
  })
})
