import { afterEach, describe, expect, it } from 'bun:test'
import { buildWorkingTreeDiffFileData } from './buildWorkingTreeDiffFileData'

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
})

type BoundedArgs = { worktree: string; path: string; opts?: { maxBytes?: number; force?: boolean } }

function installWindow(opts: {
  readFile?: () => string | null
  bounded?: (path: string) => { patch: string; tooLarge: boolean }
  onReadFile?: () => void
  onBounded?: (args: BoundedArgs) => void
} = {}) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      api: {
        fs: {
          readFile: async () => {
            opts.onReadFile?.()
            return opts.readFile ? opts.readFile() : 'current'
          },
        },
        git: {
          getFileDiff: async () => '',
          getFileDiffBounded: async (worktree: string, path: string, boundedOpts?: { maxBytes?: number; force?: boolean }) => {
            opts.onBounded?.({ worktree, path, opts: boundedOpts })
            return opts.bounded ? opts.bounded(path) : { patch: '', tooLarge: false }
          },
          showFileAtHead: async () => 'old',
        },
      },
    },
  })
}

describe('buildWorkingTreeDiffFileData', () => {
  it('does not read current file content when a patch is provided without full-context metadata', async () => {
    let readCount = 0
    installWindow({ onReadFile: () => { readCount += 1 } })

    const result = await buildWorkingTreeDiffFileData('/repo', {
      path: 'src/file.ts',
      status: 'modified',
      staged: false,
      additions: 2,
      deletions: 1,
    }, {
      includeFileDiff: false,
      patch: `diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -1 +1 @@
-old
+new
`,
    })

    expect(readCount).toBe(0)
    expect(result.additions).toBe(2)
    expect(result.deletions).toBe(1)
    expect(result.currentContent).toBeUndefined()
    expect(result.patchLoaded).toBe(true)
    expect(result.tooLarge).toBe(false)
  })

  it('fetches a bounded per-file diff when no patch is supplied', async () => {
    let boundedCalls = 0
    installWindow({
      onBounded: () => { boundedCalls += 1 },
      bounded: () => ({ patch: '@@ -1 +1 @@\n-old\n+new', tooLarge: false }),
    })

    const result = await buildWorkingTreeDiffFileData('/repo', {
      path: 'src/file.ts',
      status: 'modified',
      staged: false,
    }, { includeFileDiff: false })

    expect(boundedCalls).toBe(1)
    expect(result.patch).toContain('+new')
    expect(result.tooLarge).toBe(false)
    expect(result.patchLoaded).toBe(true)
  })

  it('synthesizes an added-file patch when git produces no diff', async () => {
    installWindow({ readFile: () => 'line one\nline two', bounded: () => ({ patch: '', tooLarge: false }) })

    const result = await buildWorkingTreeDiffFileData('/repo', {
      path: 'src/new.ts',
      status: 'added',
      staged: false,
    }, { includeFileDiff: false })

    expect(result.patch).toContain('--- /dev/null')
    expect(result.patch).toContain('+line one')
    expect(result.tooLarge).toBe(false)
  })

  it('marks a file too large and skips content + synthetic work', async () => {
    let readCount = 0
    installWindow({ onReadFile: () => { readCount += 1 }, bounded: () => ({ patch: '', tooLarge: true }) })

    const result = await buildWorkingTreeDiffFileData('/repo', {
      path: 'src/huge.ts',
      status: 'modified',
      staged: false,
    }, { includeFileDiff: false })

    expect(result.tooLarge).toBe(true)
    expect(result.patch).toBe('')
    expect(result.patchLoaded).toBe(true)
    expect(readCount).toBe(0)
  })

  it('passes force through to the bounded fetch', async () => {
    let forced: boolean | undefined
    installWindow({ onBounded: ({ opts }) => { forced = opts?.force } })

    await buildWorkingTreeDiffFileData('/repo', {
      path: 'src/huge.ts',
      status: 'modified',
      staged: false,
    }, { includeFileDiff: false, force: true })

    expect(forced).toBe(true)
  })
})
