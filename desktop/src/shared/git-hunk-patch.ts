interface ParsedGitHunkPatch {
  headerLines: string[]
  hunkBlocks: string[]
}

export interface GitPatchHunkSpan {
  deletionStart: number
  additionStart: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function listGitPatchHunkSpans(patch: string): GitPatchHunkSpan[] {
  const spans: GitPatchHunkSpan[] = []
  for (const line of patch.split('\n')) {
    const match = line.match(HUNK_HEADER)
    if (!match) continue
    spans.push({
      deletionStart: parseInt(match[1], 10),
      additionStart: parseInt(match[3], 10),
    })
  }
  return spans
}

/** Map a Pierre/UI hunk to the git patch hunk index using stable @@ line anchors. */
export function resolveGitPatchHunkIndex(
  patch: string,
  span: GitPatchHunkSpan,
  fallbackIndex?: number,
): number {
  const spans = listGitPatchHunkSpans(patch)
  const exact = spans.findIndex(
    (candidate) =>
      candidate.deletionStart === span.deletionStart
      && candidate.additionStart === span.additionStart,
  )
  if (exact >= 0) return exact
  if (fallbackIndex != null && fallbackIndex >= 0 && fallbackIndex < spans.length) {
    return fallbackIndex
  }
  throw new Error(
    `No git patch hunk matches @@ -${span.deletionStart} +${span.additionStart} (${spans.length} hunk(s) in patch)`,
  )
}

export function parseGitPatchHunks(patch: string): ParsedGitHunkPatch {
  const normalizedPatch = patch.trimEnd()
  if (!normalizedPatch) {
    throw new Error('Cannot extract a hunk from an empty patch')
  }

  const lines = normalizedPatch.split('\n')
  const headerLines: string[] = []
  const hunkBlocks: string[] = []
  let currentHunkLines: string[] | null = null

  for (const line of lines) {
    if (line.startsWith('@@ ')) {
      if (currentHunkLines) {
        hunkBlocks.push(currentHunkLines.join('\n'))
      }
      currentHunkLines = [line]
      continue
    }
    if (currentHunkLines) {
      currentHunkLines.push(line)
    } else {
      headerLines.push(line)
    }
  }

  if (currentHunkLines) {
    hunkBlocks.push(currentHunkLines.join('\n'))
  }

  if (!headerLines.some((line) => line.startsWith('diff --git '))) {
    throw new Error('Expected a unified git patch with a diff header')
  }
  if (hunkBlocks.length === 0) {
    throw new Error('Expected at least one unified diff hunk')
  }

  return { headerLines, hunkBlocks }
}

export function buildSingleHunkGitPatch(
  patch: string,
  hunkIndex: number,
  span?: GitPatchHunkSpan,
): string {
  const { headerLines, hunkBlocks } = parseGitPatchHunks(patch)
  const resolvedIndex = span
    ? resolveGitPatchHunkIndex(patch, span, hunkIndex)
    : hunkIndex
  const hunk = hunkBlocks[resolvedIndex]
  if (!hunk) {
    throw new Error(`Hunk ${resolvedIndex} is out of range`)
  }
  return [...headerLines, hunk].join('\n') + '\n'
}
