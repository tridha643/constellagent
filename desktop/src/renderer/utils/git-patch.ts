/** Unescape minimal C-style sequences Git uses in quoted diff paths. */
export function unquoteGitPath(s: string): string {
  return s.replace(/\\([\\"])/g, '$1')
}

/**
 * Prefer `+++ b/...` / `--- a/...` (unified diff); fall back to the first `diff --git` line.
 */
export function extractFilePathFromGitPatchSegment(part: string): string {
  const lines = part.split('\n')
  for (const line of lines) {
    if (line.startsWith('+++ /dev/null')) continue
    const quotedPlus = line.match(/^\+\+\+ "b\/((?:[^"\\]|\\.)*)"(?:\t.*)?$/)
    if (quotedPlus) return unquoteGitPath(quotedPlus[1])
    const plainPlus = line.match(/^\+\+\+ b\/(.+?)(?:\t|$)/)
    if (plainPlus) return plainPlus[1]
  }
  for (const line of lines) {
    if (!line.startsWith('--- a/') && !line.startsWith('--- "a/')) continue
    const quotedMinus = line.match(/^--- "a\/((?:[^"\\]|\\.)*)"(?:\t.*)?$/)
    if (quotedMinus) return unquoteGitPath(quotedMinus[1])
    const plainMinus = line.match(/^--- a\/(.+?)(?:\t|$)/)
    if (plainMinus) return plainMinus[1]
  }
  const firstLine = lines[0] || ''
  const diffCc = firstLine.match(/^diff --cc (.+)$/)
  if (diffCc) return diffCc[1].trim()
  const quotedGit = firstLine.match(/"b\/((?:[^"\\]|\\.)*)"\s*$/)
  if (quotedGit) return unquoteGitPath(quotedGit[1])
  const plainGit = firstLine.match(/\bb\/(.+)$/)
  if (plainGit) return plainGit[1]
  return 'unknown'
}

/** Split git patch output into one blob per file (`diff --git` or merge `diff --cc`). */
export function splitGitPatchIntoFiles(patchOutput: string): string[] {
  const trimmed = patchOutput.trimEnd()
  if (!trimmed) return []
  const headerRe = /^diff --(?:git|cc) /gm
  const matches = [...trimmed.matchAll(headerRe)]
  if (matches.length === 0) return [trimmed]
  return matches.map((match, index) => {
    const start = match.index!
    const end = index + 1 < matches.length ? (matches[index + 1]!.index as number) : trimmed.length
    return trimmed.slice(start, end).trimEnd()
  })
}
