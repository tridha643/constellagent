import type { OpenPrInfo } from './github-types'

export interface ActiveHashToken {
  readonly query: string
  readonly from: number
  readonly to: number
}

/** Detects a GitHub PR `#` mention being typed at the cursor. */
export function parseActiveHashToken(value: string, cursorPos: number): ActiveHashToken | null {
  const end = Math.min(Math.max(0, cursorPos), value.length)
  const before = value.slice(0, end)
  const hashIdx = before.lastIndexOf('#')
  if (hashIdx < 0) {
    return null
  }
  if (hashIdx > 0) {
    const prev = value[hashIdx - 1]
    if (prev !== undefined && !/\s/.test(prev)) {
      return null
    }
  }
  const segment = value.slice(hashIdx, end)
  if (/\s/.test(segment)) {
    return null
  }
  return { query: segment, from: hashIdx, to: end }
}

function sanitizeBranchName(value: string): string {
  return value.trim().replace(/[^\w./-]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Branch label shown in the composer PR picker (matches sidebar PR modal). */
export function prComposerBranchLabel(pr: OpenPrInfo): string {
  if (!pr.isCrossRepository) {
    const head = sanitizeBranchName(pr.headRefName)
    if (head) return head
  }
  const head = sanitizeBranchName(pr.headRefName) || `pr-${pr.number}`
  const branch = sanitizeBranchName(`pr/${pr.number}-${head}`)
  return branch || `pr/${pr.number}`
}

export function filterOpenPrsByHashQuery(
  prs: readonly OpenPrInfo[],
  hashQuery: string,
): OpenPrInfo[] {
  const needle = hashQuery.slice(1).trim().toLowerCase()
  if (!needle) {
    return [...prs]
  }
  return prs.filter((pr) => {
    const haystack = [
      String(pr.number),
      `#${pr.number}`,
      pr.title,
      pr.authorLogin ?? '',
      pr.headRefName,
      prComposerBranchLabel(pr),
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  })
}

export function formatHashMentionInsert(pr: OpenPrInfo): string {
  return `#${pr.number} `
}
