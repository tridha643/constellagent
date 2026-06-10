import { beforeAll, describe, expect, test } from 'bun:test'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Command } from '@codemirror/view'
import { Window } from 'happy-dom'
import {
  insertCodeBlock,
  insertSuggestionBlock,
  toggleBulletList,
  toggleHeading,
  toggleOrderedList,
  toggleQuote,
  toggleSuggestionBlock,
  toggleTaskList,
} from './markdownBlockCommands'

beforeAll(() => {
  const window = new Window()
  const g = globalThis as unknown as Record<string, unknown>
  g.window = window
  g.document = window.document
  g.Node = window.Node
  g.HTMLElement = window.HTMLElement
  g.SVGElement = window.SVGElement
  g.MutationObserver = window.MutationObserver
  g.ResizeObserver = window.ResizeObserver
})

interface RunResult {
  ok: boolean
  doc: string
  from: number
  to: number
}

/** Run a command against a fresh headless editor with the given doc + selection. */
function run(command: Command, doc: string, anchor = doc.length, head = anchor): RunResult {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor, head } }),
  })
  const ok = command(view)
  const result: RunResult = {
    ok,
    doc: view.state.doc.toString(),
    from: view.state.selection.main.from,
    to: view.state.selection.main.to,
  }
  view.destroy()
  parent.remove()
  return result
}

describe('toggleQuote', () => {
  test('adds prefix to a single line', () => {
    expect(run(toggleQuote, 'hello', 0).doc).toBe('> hello')
  })
  test('adds prefix to every selected line', () => {
    expect(run(toggleQuote, 'a\nb\nc', 0, 5).doc).toBe('> a\n> b\n> c')
  })
  test('strips when all selected lines are already quoted', () => {
    expect(run(toggleQuote, '> a\n> b', 0, 7).doc).toBe('a\nb')
  })
  test('all-or-nothing: adds to all when any line lacks the prefix', () => {
    expect(run(toggleQuote, '> a\nb', 0, 5).doc).toBe('> a\n> b')
  })
})

describe('toggleBulletList', () => {
  test('adds a bullet to a single line', () => {
    expect(run(toggleBulletList, 'item', 0).doc).toBe('- item')
  })
  test('toggles off when all lines are bulleted', () => {
    expect(run(toggleBulletList, '- a\n- b', 0, 7).doc).toBe('a\nb')
  })
})

describe('toggleOrderedList', () => {
  test('numbers selected lines incrementally', () => {
    expect(run(toggleOrderedList, 'a\nb\nc', 0, 5).doc).toBe('1. a\n2. b\n3. c')
  })
  test('toggles off when all lines are numbered', () => {
    expect(run(toggleOrderedList, '1. a\n2. b', 0, 9).doc).toBe('a\nb')
  })
})

describe('toggleTaskList', () => {
  test('adds an unchecked task prefix', () => {
    expect(run(toggleTaskList, 'do it', 0).doc).toBe('- [ ] do it')
  })
  test('strips when all lines are tasks', () => {
    expect(run(toggleTaskList, '- [ ] a\n- [x] b', 0, 15).doc).toBe('a\nb')
  })
})

describe('toggleHeading', () => {
  test('adds an h3 prefix', () => {
    expect(run(toggleHeading, 'Title', 0).doc).toBe('### Title')
  })
  test('strips when already h3', () => {
    expect(run(toggleHeading, '### Title', 0).doc).toBe('Title')
  })
  test('normalizes another heading level to h3', () => {
    expect(run(toggleHeading, '# Title', 0).doc).toBe('### Title')
  })
})

describe('insertCodeBlock', () => {
  test('empty selection inserts a fence with the cursor inside', () => {
    const r = run(insertCodeBlock, '', 0)
    expect(r.doc).toBe('```\n\n```\n')
    expect(r.from).toBe(4)
    expect(r.to).toBe(4)
  })
  test('wraps the selection and selects the body', () => {
    const r = run(insertCodeBlock, 'x = 1', 0, 5)
    expect(r.doc).toBe('```\nx = 1\n```\n')
    expect(r.from).toBe(4)
    expect(r.to).toBe(9)
  })
})

describe('insertSuggestionBlock', () => {
  test('empty inserts a suggestion fence with the placeholder selected', () => {
    const r = run(insertSuggestionBlock(), '', 0)
    expect(r.doc).toBe('```suggestion\nsuggested change\n```\n')
    expect(r.from).toBe(14)
    expect(r.to).toBe(14 + 'suggested change'.length)
  })
  test('honors a seed when there is no selection', () => {
    expect(run(insertSuggestionBlock('foo()'), '', 0).doc).toBe('```suggestion\nfoo()\n```\n')
  })
  test('wraps the current selection in preference to the seed', () => {
    const r = run(insertSuggestionBlock('seed'), 'bar', 0, 3)
    expect(r.doc).toBe('```suggestion\nbar\n```\n')
    expect(r.from).toBe(14)
    expect(r.to).toBe(17)
  })
})

describe('toggleSuggestionBlock', () => {
  test('outside a block inserts a seeded suggestion fence', () => {
    expect(run(toggleSuggestionBlock('foo()'), '', 0).doc).toBe('```suggestion\nfoo()\n```\n')
  })
  test('cursor inside an untouched seeded block removes the whole block', () => {
    const doc = '```suggestion\nfoo()\n```\n'
    expect(run(toggleSuggestionBlock('foo()'), doc, 16).doc).toBe('')
  })
  test('cursor inside an untouched placeholder block removes the whole block', () => {
    const doc = '```suggestion\nsuggested change\n```\n'
    expect(run(toggleSuggestionBlock(), doc, 16).doc).toBe('')
  })
  test('cursor inside an edited block unwraps the fences but keeps the body', () => {
    const doc = '```suggestion\nmy edit\n```\n'
    expect(run(toggleSuggestionBlock('foo()'), doc, 16).doc).toBe('my edit')
  })
  test('only removes the block containing the cursor', () => {
    const doc = 'note\n```suggestion\nfoo()\n```\n'
    const r = run(toggleSuggestionBlock('foo()'), doc, 21)
    expect(r.doc).toBe('note\n')
  })
  test('cursor outside an existing block inserts a new one instead of touching it', () => {
    const doc = '```suggestion\nfoo()\n```\nafter '
    const r = run(toggleSuggestionBlock('seed'), doc, doc.length)
    expect(r.doc).toBe('```suggestion\nfoo()\n```\nafter ```suggestion\nseed\n```\n')
  })
  test('handles an unclosed fence running to end-of-doc', () => {
    const doc = '```suggestion\nfoo()'
    expect(run(toggleSuggestionBlock('foo()'), doc, doc.length).doc).toBe('')
  })
})
