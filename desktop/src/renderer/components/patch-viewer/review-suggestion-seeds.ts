import type { ChangeContent, ContextContent, FileDiffMetadata } from '@pierre/diffs'

/**
 * Suggestion seed = the new-file (addition-side) text of a selected line range,
 * used to pre-fill a ```suggestion block when commenting ("grab the code into
 * the comment"). Port of rudu's `review-suggestion-seeds.ts`.
 *
 * Only addition-side lines have seedable text; if any line in the range isn't an
 * addition line (e.g. a deletion-only selection) the seed is `undefined` so the
 * caller leaves the composer empty.
 */

function isContextContent(content: ContextContent | ChangeContent): content is ContextContent {
  return content.type === 'context'
}

/** Map new-file line numbers → their text, walking the hunk content blocks. */
function getAdditionLineTextMap(fileDiff: FileDiffMetadata): Map<number, string> {
  const lineMap = new Map<number, string>()

  for (const hunk of fileDiff.hunks) {
    let nextAdditionLine = hunk.additionStart

    for (const content of hunk.hunkContent) {
      if (isContextContent(content)) {
        for (let index = 0; index < content.lines; index += 1) {
          lineMap.set(
            nextAdditionLine + index,
            fileDiff.additionLines[content.additionLineIndex + index] ?? '',
          )
        }
        nextAdditionLine += content.lines
        continue
      }

      for (let index = 0; index < content.additions; index += 1) {
        lineMap.set(
          nextAdditionLine + index,
          fileDiff.additionLines[content.additionLineIndex + index] ?? '',
        )
      }
      nextAdditionLine += content.additions
    }
  }

  return lineMap
}

export function getSuggestionSeedForLineRange(
  fileDiff: FileDiffMetadata | undefined,
  startLine: number | null,
  endLine: number | null,
): string | undefined {
  if (!fileDiff || startLine === null || endLine === null) return undefined

  const lineMap = getAdditionLineTextMap(fileDiff)
  const minLine = Math.min(startLine, endLine)
  const maxLine = Math.max(startLine, endLine)
  const selectedLines: string[] = []

  for (let lineNumber = minLine; lineNumber <= maxLine; lineNumber += 1) {
    const line = lineMap.get(lineNumber)
    if (line === undefined) return undefined
    selectedLines.push(line)
  }

  return selectedLines.join('\n')
}
