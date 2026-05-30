import { beforeAll, describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { getBuiltInSpriteSheet } from '@pierre/trees'
import {
  COMPOSER_EDITABLE_TAIL_CHAR,
  composerDraftDomMatchesText,
  ensureComposerEditableTail,
  getComposerEditorCaretOffset,
  renderComposerEditor,
  serializeComposerEditor,
  setComposerEditorCaretOffset,
} from './composer-draft-editor-dom'

beforeAll(() => {
  const window = new Window()
  const doc = window.document
  globalThis.window = window as unknown as Window & typeof globalThis.window
  globalThis.document = doc
  globalThis.Node = window.Node
  globalThis.HTMLElement = window.HTMLElement
  globalThis.Text = window.Text
  globalThis.getSelection = () => doc.getSelection()
  globalThis.Range = window.Range

  const defs = doc.createElement('div')
  defs.innerHTML = getBuiltInSpriteSheet('complete')
  doc.body.append(defs)
})

describe('composer-draft-editor-dom', () => {
  test('render + serialize roundtrip for skill with trailing space', () => {
    const root = document.createElement('div')
    const text = '/design-consultation '
    renderComposerEditor(root, text, 'default', () => {})
    expect(serializeComposerEditor(root)).toBe(text)
    const skillChip = [...root.children].find(
      (el) => el instanceof HTMLElement && el.dataset.composerToken === 'skill',
    )
    expect(skillChip).toBeDefined()
  })

  test('ensureComposerEditableTail appends invisible anchor after chip-only draft', () => {
    const root = document.createElement('div')
    renderComposerEditor(root, '/nia', 'default', () => {})
    const tail = ensureComposerEditableTail(root)
    expect(tail?.textContent).toBe(COMPOSER_EDITABLE_TAIL_CHAR)
    expect(serializeComposerEditor(root)).toBe('/nia')
    expect(composerDraftDomMatchesText(root, '/nia')).toBe(true)
  })

  test('skill chips resolve pierre/trees markdown icons', () => {
    const root = document.createElement('div')
    renderComposerEditor(root, '/autoplan ', 'default', () => {})
    const skillChip = [...root.children].find(
      (el) => el instanceof HTMLElement && el.dataset.composerToken === 'skill',
    )
    const icon = skillChip?.firstElementChild?.firstElementChild?.firstElementChild
    expect(icon?.localName).toBe('svg')
    expect(icon?.getAttribute('data-file-icon-token')).toBe('markdown')
    const use = icon?.firstElementChild
    expect(use?.localName).toBe('use')
    expect(use?.getAttribute('href')).toMatch(/file-tree-builtin-markdown$/)
  })

  test('setComposerEditorCaretOffset places caret at end of draft', () => {
    const root = document.createElement('div')
    const text = '/nia '
    renderComposerEditor(root, text, 'default', () => {})
    root.focus()
    setComposerEditorCaretOffset(root, text.length, text.length)
    expect(getComposerEditorCaretOffset(root)).toBe(text.length)
  })

  test('render + serialize roundtrip for pr mention with trailing space', () => {
    const root = document.createElement('div')
    const text = '#170 '
    renderComposerEditor(root, text, 'default', () => {})
    expect(serializeComposerEditor(root)).toBe(text)
    const prChip = [...root.children].find(
      (el) => el instanceof HTMLElement && el.dataset.composerToken === 'pr',
    )
    expect(prChip).toBeDefined()
    expect(prChip?.getAttribute('data-testid')).toBe('composer-pr-chip')
  })
})
