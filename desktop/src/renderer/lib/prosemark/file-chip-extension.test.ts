import { beforeAll, describe, expect, test } from 'bun:test'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { Window } from 'happy-dom'
import {
  markdownFileChipExtension,
  markdownLinkLabelFromText,
  resolveFileChipLabel,
} from './file-chip-extension'

describe('markdownLinkLabelFromText', () => {
  test('preserves the visible label from markdown file links', () => {
    expect(
      markdownLinkLabelFromText(
        '[agent-driver.ts](/Users/tri/Desktop/everything-reborn-v1/constellagent/desktop/src/main/agents/agent-driver.ts:48)',
      ),
    ).toBe('agent-driver.ts')
  })

  test('returns undefined for empty link labels', () => {
    expect(markdownLinkLabelFromText('[](/tmp/app.ts)')).toBeUndefined()
  })
})

describe('resolveFileChipLabel', () => {
  const raw =
    '[file-chip-extension.ts](desktop/src/renderer/lib/prosemark/file-chip-extension.ts)'
  const displayPath = 'desktop/src/renderer/lib/prosemark/file-chip-extension.ts'

  test('uses basename when label is dash-only', () => {
    expect(resolveFileChipLabel(raw, '--', displayPath)).toBe('file-chip-extension.ts')
    expect(resolveFileChipLabel(raw, '-', displayPath)).toBe('file-chip-extension.ts')
  })

  test('uses basename when label matches full path', () => {
    expect(resolveFileChipLabel(raw, displayPath, displayPath)).toBe('file-chip-extension.ts')
  })

  test('keeps intentional short aliases', () => {
    expect(resolveFileChipLabel(raw, 'agent driver', displayPath)).toBe('agent driver')
  })
})

describe('markdownFileChipExtension DOM', () => {
  beforeAll(() => {
    const window = new Window()
    const doc = window.document
    globalThis.window = window as unknown as Window & typeof globalThis.window
    globalThis.document = doc
    globalThis.Node = window.Node
    globalThis.HTMLElement = window.HTMLElement
    globalThis.SVGElement = window.SVGElement
    globalThis.MutationObserver = window.MutationObserver
    globalThis.ResizeObserver = window.ResizeObserver
  })

  test('renders full basenames in list-item file links', () => {
    const md = [
      '- [file-chip-extension.ts](desktop/src/renderer/lib/prosemark/file-chip-extension.ts) now falls back',
      '- [prosemark-chat-theme.css](desktop/src/renderer/lib/prosemark/prosemark-chat-theme.css) no longer constrains',
      '- [file-chip-extension.test.ts](desktop/src/renderer/lib/prosemark/file-chip-extension.test.ts) adds test',
    ].join('\n')

    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: md,
        extensions: [
          markdown({ extensions: [GFM] }),
          markdownFileChipExtension({ worktreePath: '/Users/tri/Desktop/everything-reborn-v1/constellagent' }),
        ],
      }),
    })

    const labels: string[] = []
    const visit = (node: Node) => {
      if (node instanceof HTMLElement && node.classList.contains('cm-file-chip-label')) {
        labels.push(node.textContent ?? '')
      }
      for (const child of node.childNodes) visit(child)
    }
    visit(parent)
    expect(labels).toEqual([
      'file-chip-extension.ts',
      'prosemark-chat-theme.css',
      'file-chip-extension.test.ts',
    ])

    view.destroy()
    parent.remove()
  })
})
