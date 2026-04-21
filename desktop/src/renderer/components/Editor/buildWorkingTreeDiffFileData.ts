import { getSingularPatch, parseDiffFromFile, type FileDiffMetadata } from '@pierre/diffs'
import type { DiffFileData, WorkingTreeFileStatus } from '../../types/working-tree-diff'

interface BuildWorkingTreeDiffOptions {
  includeFileDiff?: boolean
  patch?: string
  currentContent?: string | null
  hasMixedStageState?: boolean
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
  const currentContent = file.currentContent ?? await readWorkingTreeCurrentContent(worktreePath, file.filePath, file.status)

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
  const currentContent = options.currentContent ?? await readWorkingTreeCurrentContent(worktreePath, file.path, file.status)

  if (!patch && (file.status === 'added' || file.status === 'untracked')) {
    patch = await window.api.git.getFileDiff(worktreePath, file.path)
  }

  if (!patch && (file.status === 'added' || file.status === 'untracked') && currentContent !== null) {
    patch = buildSyntheticAddedPatch(file.path, currentContent)
  }

  if (!patch && file.status === 'deleted') {
    patch = `--- a/${file.path}\n+++ /dev/null\n@@ -1,0 +0,0 @@\n`
  }

  let fileDiff: FileDiffMetadata | undefined
  if (includeFileDiff) {
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
    hasMixedStageState: options.hasMixedStageState ?? false,
    fileDiff,
    currentContent,
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
