interface ParsedGitHunkPatch {
  headerLines: string[]
  hunkBlocks: string[]
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

export function buildSingleHunkGitPatch(patch: string, hunkIndex: number): string {
  const { headerLines, hunkBlocks } = parseGitPatchHunks(patch)
  const hunk = hunkBlocks[hunkIndex]
  if (!hunk) {
    throw new Error(`Hunk ${hunkIndex} is out of range`)
  }
  return [...headerLines, hunk].join('\n') + '\n'
}
