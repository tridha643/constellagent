import { getSingularPatch, parseDiffFromFile, type FileDiffMetadata } from '@pierre/diffs'
import {
  MAX_FILE_DIFF_BYTES,
  type DiffFileData,
  type WorkingTreeFileStatus,
} from '../../types/working-tree-diff'

interface BuildWorkingTreeDiffOptions {
  includeFileDiff?: boolean
  patch?: string
  currentContent?: string | null
  hasMixedStageState?: boolean
  /** Bypass the per-file byte ceiling (user clicked "load anyway"). */
  force?: boolean
}

/** UTF-8 byte length of a string without allocating the encoded buffer. */
function utf8ByteLength(s: string): number {
  // Bytes are between 1x and 3x the code-unit count (4 bytes per 2-unit
  // surrogate pair = 2 bytes/unit), so these bounds skip the scan in the common
  // (well within / well over the ceiling) cases.
  if (s.length > MAX_FILE_DIFF_BYTES) return s.length // already over (bytes ≥ units)
  if (s.length * 3 <= MAX_FILE_DIFF_BYTES) return s.length // can't exceed even at 3x
  let bytes = 0
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      i += 1 // consume the low surrogate
    } else bytes += 3
  }
  return bytes
}

function buildSyntheticAddedPatch(filePath: string, content: string): string {
  const lines = content.split('\n')
  return [
    '--- /dev/null',
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join('\n')
}

function canBuildExpandableDiff(status: WorkingTreeFileStatus['status'], headContent: string | null, currentContent: string | null) {
  if (currentContent == null) return false
  if (status === 'added' || status === 'untracked') return true
  return headContent != null
}

function resolvePreviousPath(filePath: string, patch: string): string {
  if (!patch) return filePath
  try {
    const parsed = getSingularPatch(patch)
    return parsed.prevName ?? filePath
  } catch {
    return filePath
  }
}

export async function loadWorkingTreeExpandableDiffMetadata(
  worktreePath: string,
  file: Pick<DiffFileData, 'filePath' | 'patch' | 'status' | 'currentContent'>,
): Promise<FileDiffMetadata | undefined> {
  const previousPath = resolvePreviousPath(file.filePath, file.patch)
  const currentContent = file.currentContent !== undefined
    ? file.currentContent
    : await readWorkingTreeCurrentContent(worktreePath, file.filePath, file.status)

  const headContent =
    file.status === 'added' || file.status === 'untracked'
      ? null
      : await window.api.git.showFileAtHead(worktreePath, previousPath)

  if (!canBuildExpandableDiff(file.status, headContent, currentContent)) {
    return undefined
  }

  try {
    return parseDiffFromFile(
      { name: previousPath, contents: headContent ?? '' },
      { name: file.filePath, contents: currentContent ?? '' },
      { context: 3 },
    )
  } catch (error) {
    console.warn('Failed to build expandable file diff metadata:', error)
    return undefined
  }
}

export async function buildWorkingTreeDiffFileData(
  worktreePath: string,
  file: WorkingTreeFileStatus,
  options: BuildWorkingTreeDiffOptions = {},
): Promise<DiffFileData> {
  const includeFileDiff = options.includeFileDiff ?? true
  let patch = options.patch ?? ''
  let tooLarge = false

  // No patch supplied → fetch a coherent per-file diff (modified/deleted/
  // staged/unstaged/mixed via `git diff HEAD -- <path>`), bounded by a byte
  // ceiling so one huge file can't stall the viewer. This replaces the old
  // whole-tree split: every file is fetched independently and lazily.
  if (!patch) {
    const bounded = await window.api.git.getFileDiffBounded(worktreePath, file.path, {
      force: options.force,
    })
    patch = bounded.patch
    tooLarge = bounded.tooLarge
  }

  // Current content is only needed to synthesize a patch git couldn't produce
  // (new files) or to build expandable full-file metadata — never for a
  // too-large file (it would be just as large).
  let currentContent = options.currentContent
  const isNewFile = file.status === 'added' || file.status === 'untracked'
  const needsSyntheticAdd = !patch && !tooLarge && isNewFile
  if (currentContent === undefined && !tooLarge && (includeFileDiff || needsSyntheticAdd)) {
    currentContent = await readWorkingTreeCurrentContent(worktreePath, file.path, file.status)
  }

  // Synthetic fallbacks only when git produced nothing (and the file isn't huge).
  if (needsSyntheticAdd && currentContent != null) {
    // Measure UTF-8 bytes (not UTF-16 code units) so the ceiling matches the
    // main-process one — multibyte (e.g. CJK) content must not slip past it.
    if (!options.force && utf8ByteLength(currentContent) > MAX_FILE_DIFF_BYTES) {
      tooLarge = true
    } else {
      patch = buildSyntheticAddedPatch(file.path, currentContent)
    }
  }

  if (!patch && !tooLarge && file.status === 'deleted') {
    patch = `--- a/${file.path}\n+++ /dev/null\n@@ -1,0 +0,0 @@\n`
  }

  let fileDiff: FileDiffMetadata | undefined
  if (includeFileDiff && !tooLarge) {
    fileDiff = await loadWorkingTreeExpandableDiffMetadata(worktreePath, {
      filePath: file.path,
      patch,
      status: file.status,
      currentContent,
    })
  }

  return {
    filePath: file.path,
    patch: patch || '',
    status: file.status,
    staged: file.staged,
    additions: file.additions,
    deletions: file.deletions,
    hasMixedStageState: options.hasMixedStageState ?? false,
    fileDiff,
    patchLoaded: true,
    currentContent,
    tooLarge,
  }
}

async function readWorkingTreeCurrentContent(
  worktreePath: string,
  filePath: string,
  status: WorkingTreeFileStatus['status'],
): Promise<string | null> {
  if (status === 'deleted') return ''
  const fullPath = filePath.startsWith('/')
    ? filePath
    : `${worktreePath}/${filePath}`
  try {
    return await window.api.fs.readFile(fullPath)
  } catch {
    return null
  }
}
