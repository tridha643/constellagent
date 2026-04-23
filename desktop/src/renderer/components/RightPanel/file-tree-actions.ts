export type FileTreeAction = 'collapseAll' | 'newFile' | 'newFolder' | 'focusSearch'

type Listener = (action: FileTreeAction) => void

const listeners = new Set<Listener>()

export const fileTreeActions = {
  emit(action: FileTreeAction) {
    for (const listener of listeners) listener(action)
  },
  on(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
