import { buildWorkingTreeDiffFileData } from './buildWorkingTreeDiffFileData'
import { measureAsync } from '../../utils/perf'
import {
  buildWorkingTreeStatusSignature,
  type DiffFileData,
  type GitStatusSnapshot,
} from '../../types/working-tree-diff'
import { extractFilePathFromGitPatchSegment, splitGitPatchIntoFiles } from '../../utils/git-patch'

const DEFAULT_CONCURRENCY = 4
const EARLY_PROGRESS_UPDATES = 3
const PROGRESS_UPDATE_EVERY = 5
const PRELOAD_FULL_DIFF_COUNT = 3

interface LoadWorkingTreeDiffFilesOptions {
  worktreePath: string
  concurrency?: number
  isCancelled?: () => boolean
  onProgress?: (files: DiffFileData[]) => void
  onStatusSnapshot?: (snapshot: GitStatusSnapshot) => void
  statusSnapshot?: GitStatusSnapshot
  source: 'diff-viewer' | 'hunk-review'
}

export async function loadWorkingTreeDiffFiles({
  worktreePath,
  concurrency = DEFAULT_CONCURRENCY,
  isCancelled,
  onProgress,
  onStatusSnapshot,
  statusSnapshot,
  source,
}: LoadWorkingTreeDiffFilesOptions): Promise<DiffFileData[]> {
  const snapshot = statusSnapshot ?? await measureAsync('git:get-status-snapshot-for-diff', async () => {
    const [statuses, headHash] = await Promise.all([
      window.api.git.getStatus(worktreePath),
      window.api.git.getHeadHash(worktreePath),
    ])
    return {
      statuses,
      headHash,
      signature: buildWorkingTreeStatusSignature(statuses, headHash),
      updatedAt: Date.now(),
    } satisfies GitStatusSnapshot
  }, {
    source,
    worktreePath,
  })
  onStatusSnapshot?.(snapshot)

  const statuses = snapshot.statuses
  if (isCancelled?.()) return []
  if (statuses.length === 0) return []

  const statusKindsByPath = new Map<string, Set<'staged' | 'unstaged'>>()
  for (const status of statuses) {
    let kinds = statusKindsByPath.get(status.path)
    if (!kinds) {
      kinds = new Set<'staged' | 'unstaged'>()
      statusKindsByPath.set(status.path, kinds)
    }
    kinds.add(status.staged ? 'staged' : 'unstaged')
  }

  const workingTreePatch = await measureAsync('git:get-working-tree-diff-for-diff', () => (
    window.api.git.getWorkingTreeDiff(worktreePath)
  ), {
    source,
    worktreePath,
    fileCount: statuses.length,
  })
  const patchByPath = new Map<string, string>()
  for (const part of splitGitPatchIntoFiles(workingTreePatch)) {
    patchByPath.set(extractFilePathFromGitPatchSegment(part), part)
  }

  const results: Array<DiffFileData | undefined> = new Array(statuses.length)
  const orderedProgress: DiffFileData[] = []
  let nextIndex = 0
  let nextContiguousIndex = 0
  let resolvedCount = 0

  const publishProgress = () => {
    if (!onProgress) return
    onProgress([...orderedProgress])
  }

  const shouldPublish = () =>
    resolvedCount <= EARLY_PROGRESS_UPDATES
    || resolvedCount === statuses.length
    || resolvedCount % PROGRESS_UPDATE_EVERY === 0

  async function worker(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (isCancelled?.()) return
      const index = nextIndex
      nextIndex += 1
      if (index >= statuses.length) return

      const status = statuses[index]
      if (!status) return

      const result = await buildWorkingTreeDiffFileData(worktreePath, status, {
        includeFileDiff: index < PRELOAD_FULL_DIFF_COUNT,
        patch: patchByPath.get(status.path) ?? '',
        hasMixedStageState: statusKindsByPath.get(status.path)?.size === 2,
      })
      if (isCancelled?.()) return

      results[index] = result
      while (nextContiguousIndex < results.length && results[nextContiguousIndex]) {
        orderedProgress.push(results[nextContiguousIndex]!)
        nextContiguousIndex += 1
      }
      resolvedCount += 1
      if (shouldPublish()) publishProgress()
    }
  }

  const workerCount = Math.min(concurrency, statuses.length)
  await measureAsync('diff:build-working-tree-files', async () => {
    await Promise.all(
      Array.from({ length: workerCount }, () => worker()),
    )
  }, {
    source,
    worktreePath,
    fileCount: statuses.length,
    concurrency: workerCount,
  })

  if (isCancelled?.()) return []
  const finalFiles = results.filter((file): file is DiffFileData => file !== undefined)
  publishProgress()
  return finalFiles
}
