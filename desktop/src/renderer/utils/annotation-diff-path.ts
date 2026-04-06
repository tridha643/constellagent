/**
 * Match annotation DB paths to git diff file paths (same logical file, possibly
 * different string form: slashes, ./ prefix, or repo-relative vs subdir).
 */

export function normalizeRepoRelativePath(p: string): string {
  return p
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
}

function basename(p: string): string {
  const n = normalizeRepoRelativePath(p)
  const i = n.lastIndexOf('/')
  return i >= 0 ? n.slice(i + 1) : n
}

/**
 * Returns the `filePath` from the current diff list that corresponds to the
 * annotation's stored path, or null if none can be resolved.
 */
export function resolveAnnotationPathForDiff(
  storedPath: string,
  diffFilePaths: readonly string[],
): string | null {
  if (diffFilePaths.length === 0) return null
  const n = normalizeRepoRelativePath(storedPath)
  if (!n) return null

  for (const d of diffFilePaths) {
    if (normalizeRepoRelativePath(d) === n) return d
  }

  for (const d of diffFilePaths) {
    const dn = normalizeRepoRelativePath(d)
    if (dn === n || dn.endsWith('/' + n)) return d
  }

  const want = basename(n)
  const byBase = diffFilePaths.filter((d) => basename(d) === want)
  if (byBase.length === 1) return byBase[0]

  return null
}
