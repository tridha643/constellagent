import { useEffect, useRef, useCallback } from 'react'
import { diffLines } from 'diff'
import type { editor } from 'monaco-editor'
import { measureAsync } from '../utils/perf'

interface GutterChange {
  type: 'added' | 'modified' | 'deleted'
  startLine: number
  endLine: number
}

const MAX_GUTTER_DIFF_BYTES = 200_000

/**
 * Computes git gutter decorations by diffing the HEAD version of a file
 * against the current editor content, then applies Monaco line decorations.
 *
 * No-op when `editorInstance` is null or `worktreePath` is undefined.
 */
export function useGitGutter(
  editorInstance: editor.IStandaloneCodeEditor | null,
  filePath: string,
  worktreePath: string | undefined,
) {
  const headContentRef = useRef<string | null>(null)
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const headFetchRequestRef = useRef(0)

  const computeRelativePath = useCallback(() => {
    if (!worktreePath) return null
    // filePath is absolute; strip worktreePath prefix to get repo-relative path
    if (!filePath.startsWith(worktreePath)) return null
    let rel = filePath.slice(worktreePath.length)
    if (rel.startsWith('/')) rel = rel.slice(1)
    return rel
  }, [filePath, worktreePath])

  const computeAndApply = useCallback(() => {
    if (!editorInstance || headContentRef.current === null) return

    const currentContent = editorInstance.getValue()
    const headContent = headContentRef.current
    if (currentContent.length + headContent.length > MAX_GUTTER_DIFF_BYTES) {
      decorationsRef.current?.clear()
      return
    }

    const changes = computeChanges(headContent, currentContent)
    const decorations = changesToDecorations(changes)

    if (!decorationsRef.current) {
      decorationsRef.current = editorInstance.createDecorationsCollection(decorations)
    } else {
      decorationsRef.current.set(decorations)
    }
  }, [editorInstance])

  const refreshHeadContent = useCallback(async (reason: 'initial' | 'focus' | 'git-change' | 'dir-change') => {
    if (!worktreePath) return
    const relPath = computeRelativePath()
    if (!relPath) return
    const requestId = ++headFetchRequestRef.current
    const content = await measureAsync('editor:git-gutter-head', () => window.api.git.showFileAtHead(worktreePath, relPath), {
      filePath,
      reason,
      worktreePath,
    })
    if (requestId !== headFetchRequestRef.current) return
    headContentRef.current = content ?? ''
    computeAndApply()
  }, [computeAndApply, computeRelativePath, filePath, worktreePath])

  // Fetch HEAD content when editor is ready and file path changes
  useEffect(() => {
    if (!editorInstance || !worktreePath) return

    let cancelled = false

    void refreshHeadContent('initial').then(() => {
      if (cancelled) return
    })

    return () => {
      cancelled = true
      headFetchRequestRef.current += 1
    }
  }, [editorInstance, filePath, worktreePath, refreshHeadContent])

  // Listen for editor content changes (debounced)
  useEffect(() => {
    if (!editorInstance || !worktreePath) return

    const relPath = computeRelativePath()
    if (!relPath) return

    // Recompute decorations on content change (debounced 300ms)
    const contentDisposable = editorInstance.onDidChangeModelContent(() => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        computeAndApply()
      }, 300)
    })

    return () => {
      contentDisposable.dispose()
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [editorInstance, worktreePath, computeRelativePath, computeAndApply])

  // Re-fetch HEAD content on editor focus (catches external commits/saves)
  useEffect(() => {
    if (!editorInstance || !worktreePath) return

    const focusDisposable = editorInstance.onDidFocusEditorText(() => {
      void refreshHeadContent('focus')
    })

    return () => {
      focusDisposable.dispose()
    }
  }, [editorInstance, worktreePath, refreshHeadContent])

  // Re-fetch HEAD when in-app git operations (discard, commit) affect this file
  useEffect(() => {
    if (!editorInstance || !worktreePath) return
    const relPath = computeRelativePath()
    if (!relPath) return

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.worktreePath !== worktreePath) return
      if (!detail.paths?.includes(relPath)) return

      void refreshHeadContent('git-change')
    }
    window.addEventListener('git:files-changed', handler)
    return () => window.removeEventListener('git:files-changed', handler)
  }, [editorInstance, worktreePath, computeRelativePath, refreshHeadContent])

  // Watch for external changes (terminal git operations, branch switches)
  useEffect(() => {
    if (!editorInstance || !worktreePath) return
    const relPath = computeRelativePath()
    if (!relPath) return

    let watcherTimer: ReturnType<typeof setTimeout> | null = null

    const cleanup = window.api.fs.onDirChanged((changedDir) => {
      if (changedDir !== worktreePath) return
      if (watcherTimer) clearTimeout(watcherTimer)
      watcherTimer = setTimeout(() => {
        void refreshHeadContent('dir-change')
      }, 600)
    })

    return () => {
      cleanup()
      if (watcherTimer) clearTimeout(watcherTimer)
    }
  }, [editorInstance, worktreePath, computeRelativePath, refreshHeadContent])

  // Cleanup decorations on unmount
  useEffect(() => {
    return () => {
      if (decorationsRef.current) {
        decorationsRef.current.clear()
        decorationsRef.current = null
      }
    }
  }, [])
}

/**
 * Classify diff results into added, modified, and deleted changes.
 *
 * Adjacent removed+added pairs → modified.
 * Standalone added → added.
 * Standalone removed → deleted (marker between lines).
 */
function computeChanges(original: string, modified: string): GutterChange[] {
  const diffs = diffLines(original, modified)
  const changes: GutterChange[] = []

  let currentLine = 1

  for (let i = 0; i < diffs.length; i++) {
    const part = diffs[i]
    const lineCount = countLines(part.value)

    if (!part.added && !part.removed) {
      // Unchanged — advance line counter
      currentLine += lineCount
      continue
    }

    if (part.removed) {
      const next = diffs[i + 1]
      if (next?.added) {
        // Adjacent removed + added → modified
        const addedLineCount = countLines(next.value)
        changes.push({
          type: 'modified',
          startLine: currentLine,
          endLine: currentLine + addedLineCount - 1,
        })
        currentLine += addedLineCount
        i++ // skip the added part (already consumed)
      } else {
        // Standalone removed → deleted marker
        changes.push({
          type: 'deleted',
          startLine: Math.max(1, currentLine - 1),
          endLine: Math.max(1, currentLine - 1),
        })
        // currentLine doesn't advance — lines were removed
      }
    } else if (part.added) {
      // Standalone added
      changes.push({
        type: 'added',
        startLine: currentLine,
        endLine: currentLine + lineCount - 1,
      })
      currentLine += lineCount
    }
  }

  return changes
}

function countLines(value: string): number {
  if (!value) return 0
  // Count actual line breaks. A trailing newline doesn't produce an extra "line" of content.
  const lines = value.split('\n')
  // If the last element is empty (trailing newline), don't count it
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
}

function changesToDecorations(
  changes: GutterChange[],
): editor.IModelDeltaDecoration[] {
  return changes.map((change) => {
    let linesDecorationsClassName: string
    switch (change.type) {
      case 'added':
        linesDecorationsClassName = 'git-gutter-added'
        break
      case 'modified':
        linesDecorationsClassName = 'git-gutter-modified'
        break
      case 'deleted':
        linesDecorationsClassName = 'git-gutter-deleted'
        break
    }

    return {
      range: {
        startLineNumber: change.startLine,
        startColumn: 1,
        endLineNumber: change.endLine,
        endColumn: 1,
      },
      options: {
        linesDecorationsClassName,
        isWholeLine: true,
      },
    }
  })
}
