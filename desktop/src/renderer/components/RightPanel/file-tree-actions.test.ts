import { describe, expect, it } from 'bun:test'
import { fileTreeActions, type FileTreeAction } from './file-tree-actions'

describe('fileTreeActions bus', () => {
  it('dispatches actions to every subscriber', () => {
    const received: FileTreeAction[] = []
    const unsubA = fileTreeActions.on((action) => received.push(action))
    const unsubB = fileTreeActions.on((action) => received.push(action))

    fileTreeActions.emit('collapseAll')
    fileTreeActions.emit('newFile')

    expect(received).toEqual(['collapseAll', 'collapseAll', 'newFile', 'newFile'])

    unsubA()
    unsubB()
  })

  it('unsubscribes cleanly', () => {
    const received: FileTreeAction[] = []
    const unsub = fileTreeActions.on((action) => received.push(action))

    fileTreeActions.emit('focusSearch')
    unsub()
    fileTreeActions.emit('newFolder')

    expect(received).toEqual(['focusSearch'])
  })
})
