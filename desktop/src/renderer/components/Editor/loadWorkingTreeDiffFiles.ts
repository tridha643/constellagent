import { buildWorkingTreeDiffFileData } from './buildWorkingTreeDiffFileData'
import { measureAsync } from '../../utils/perf'
import {
  buildWorkingTreeStatusSignature,
  type DiffFileData,
  type GitStatusSnapshot,
} from '../../types/working-tree-diff'

const DEFAULT_CONCURRENCY = 4
const EARLY_PROGRESS_UPDATES = 3
const PROGRESS_UPDATE_EVERY = 5
// Eagerly build real per-file patches for the first N files (≈ the auto-expand
// budget + margin); everything else stays status-only and hydrates lazily via
// the patch queue when scrolled/expanded. This replaces fetching the whole
// working-tree diff as one (potentially 30 MB+) string — which silently failed
// past git's 10 MB output cap and rendered nothing.
const WARM_FILE_COUNT = 20
// On very large changesets, warm even fewer — the viewer collapses by default
// anyway (summary mode), so eager patches are wasted work.
const SUMMARY_WARM_FILE_COUNT = 5
const SUMMARY_FILE_THRESHOLD = 1000
const SUMMARY_DELTA_LINE_THRESHOLD = 100_000

interface LoadWorkingTreeDiffFilesOptions {
  worktreePath: string
  concurrency?: number
  /** Override the number of files to eagerly build real patches for. */
  warmFileCount?: number
  isCancelled?: () => boolean
  onProgress?: (files: DiffFileData[]) => void
  onStatusSnapshot?: (snapshot: GitStatusSnapshot) => void
  statusSnapshot?: GitStatusSnapshot
  source: 'diff-viewer' | 'hunk-review'
}

export async function loadWorkingTreeDiffFiles({
  worktreePath,
  concurrency = DEFAULT_CONCURRENCY,
  warmFileCount,
  isCancelled,
  onProgress,
  onStatusSnapshot,
  statusSnapshot,
  source,
}: LoadWorkingTreeDiffFilesOptions): Promise<DiffFileData[]> {
  const snapshot: GitStatusSnapshot = statusSnapshot ?? await measureAsync('git:get-status-snapshot-for-diff', async () => {
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

  const statusOnlyFiles: DiffFileData[] = statuses.map((status) => ({
    filePath: status.path,
    patch: '',
    status: status.status,
    staged: status.staged,
    additions: status.additions,
    deletions: status.deletions,
    hasMixedStageState: statusKindsByPath.get(status.path)?.size === 2,
    patchLoaded: false,
  }))
  onProgress?.(statusOnlyFiles)

  // Warm only the leading window of files; on very large changesets warm even
  // fewer since the viewer collapses everything by default.
  let totalDeltaLines = 0
  for (const status of statuses) {
    totalDeltaLines += (status.additions ?? 0) + (status.deletions ?? 0)
  }
  const summaryMode =
    statuses.length >= SUMMARY_FILE_THRESHOLD || totalDeltaLines >= SUMMARY_DELTA_LINE_THRESHOLD
  const warmCount = Math.min(
    warmFileCount ?? (summaryMode ? SUMMARY_WARM_FILE_COUNT : WARM_FILE_COUNT),
    statuses.length,
  )

  // Start from the status-only rows; warm files overwrite their slot in place,
  // the rest keep patchLoaded:false until the lazy queue fetches them.
  const results: DiffFileData[] = statusOnlyFiles.slice()
  let nextIndex = 0
  let resolvedCount = 0

  const publishProgress = () => {
    if (!onProgress) return
    onProgress(results.slice())
  }

  const shouldPublish = () =>
    resolvedCount <= EARLY_PROGRESS_UPDATES
    || resolvedCount === warmCount
    || resolvedCount % PROGRESS_UPDATE_EVERY === 0

  async function worker(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (isCancelled?.()) return
      const index = nextIndex
      nextIndex += 1
      if (index >= warmCount) return

      const status = statuses[index]
      if (!status) return

      // No `patch` passed → the builder fetches a coherent, byte-bounded per-file
      // diff. `includeFileDiff:false` keeps first paint cheap; the lazy queue in
      // useWorkingTreeDiff loads expandable full-file metadata off the critical path.
      const result = await buildWorkingTreeDiffFileData(worktreePath, status, {
        includeFileDiff: false,
        hasMixedStageState: statusKindsByPath.get(status.path)?.size === 2,
      })
      if (isCancelled?.()) return

      results[index] = result
      resolvedCount += 1
      if (shouldPublish()) publishProgress()
    }
  }

  const workerCount = Math.min(concurrency, warmCount)
  await measureAsync('diff:build-working-tree-files', async () => {
    await Promise.all(
      Array.from({ length: workerCount }, () => worker()),
    )
  }, {
    source,
    worktreePath,
    fileCount: statuses.length,
    warmCount,
    concurrency: workerCount,
  })

  if (isCancelled?.()) return []
  publishProgress()
  return results
}
