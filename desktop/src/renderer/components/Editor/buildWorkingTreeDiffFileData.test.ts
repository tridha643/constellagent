import { afterEach, describe, expect, it } from 'bun:test'
import { buildWorkingTreeDiffFileData } from './buildWorkingTreeDiffFileData'

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
})

describe('buildWorkingTreeDiffFileData', () => {
  it('does not read current file content when a patch is provided without full-context metadata', async () => {
    let readCount = 0
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        api: {
          fs: {
            readFile: async () => {
              readCount += 1
              return 'current'
            },
          },
          git: {
            getFileDiff: async () => '',
            showFileAtHead: async () => 'old',
          },
        },
      },
    })

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
  })
})
