import { useAppStore } from '../store/app-store'

export type ChangesFindSourceId = 'diff-tab' | 'changes-panel'

export interface ChangesFindContext {
  worktreePath: string
  paths: string[]
  onPick: (path: string) => void
}

const sources = new Map<ChangesFindSourceId, () => ChangesFindContext | null>()

let pickHandler: ((path: string) => void) | null = null

export function registerChangesFindSource(
  id: ChangesFindSourceId,
  getContext: () => ChangesFindContext | null,
): () => void {
  sources.set(id, getContext)
  return () => {
    if (sources.get(id) === getContext) sources.delete(id)
  }
}

export function tryOpenChangesFindFromSource(id: ChangesFindSourceId): boolean {
  const getContext = sources.get(id)
  const ctx = getContext?.() ?? null
  if (!ctx || ctx.paths.length === 0) return false
  pickHandler = ctx.onPick
  useAppStore.getState().openChangesFileFind({ worktreePath: ctx.worktreePath, paths: ctx.paths })
  return true
}

export function completeChangesFileFindSelection(path: string): void {
  pickHandler?.(path)
  pickHandler = null
  useAppStore.getState().closeChangesFileFind()
}

export function cancelChangesFileFindSelection(): void {
  pickHandler = null
  useAppStore.getState().closeChangesFileFind()
}
