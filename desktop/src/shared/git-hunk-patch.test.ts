import { describe, expect, test } from 'bun:test'
import {
  buildSingleHunkGitPatch,
  listGitPatchHunkSpans,
  resolveGitPatchHunkIndex,
} from './git-hunk-patch'

const SAMPLE_PATCH = [
  'diff --git a/src/target.ts b/src/target.ts',
  'index 1111111..2222222 100644',
  '--- a/src/target.ts',
  '+++ b/src/target.ts',
  '@@ -2,1 +2,1 @@',
  ' export const target1 = 1',
  '-export const target2 = 2',
  '+export const target2 = 200',
  ' export const target3 = 3',
  '@@ -16,1 +16,1 @@',
  ' export const target15 = 15',
  '-export const target16 = 16',
  '+export const target16 = 1600',
  ' export const target17 = 17',
].join('\n')

describe('listGitPatchHunkSpans', () => {
  test('parses @@ anchors from a multi-hunk patch', () => {
    expect(listGitPatchHunkSpans(SAMPLE_PATCH)).toEqual([
      { deletionStart: 2, additionStart: 2 },
      { deletionStart: 16, additionStart: 16 },
    ])
  })
})

describe('resolveGitPatchHunkIndex', () => {
  test('finds hunk by stable line anchors when UI index is stale', () => {
    const remainingPatch = [
      'diff --git a/src/target.ts b/src/target.ts',
      'index 1111111..2222222 100644',
      '--- a/src/target.ts',
      '+++ b/src/target.ts',
      '@@ -16,1 +16,1 @@',
      ' export const target15 = 15',
      '-export const target16 = 16',
      '+export const target16 = 1600',
      ' export const target17 = 17',
    ].join('\n')

    expect(
      resolveGitPatchHunkIndex(
        remainingPatch,
        { deletionStart: 16, additionStart: 16 },
        1,
      ),
    ).toBe(0)
  })

  test('falls back to UI index when anchors still align', () => {
    expect(
      resolveGitPatchHunkIndex(
        SAMPLE_PATCH,
        { deletionStart: 2, additionStart: 2 },
        0,
      ),
    ).toBe(0)
  })
})

describe('buildSingleHunkGitPatch', () => {
  test('extracts the hunk selected by span after partial keep renumbers the patch', () => {
    const remainingPatch = [
      'diff --git a/src/target.ts b/src/target.ts',
      'index 1111111..2222222 100644',
      '--- a/src/target.ts',
      '+++ b/src/target.ts',
      '@@ -16,1 +16,1 @@',
      ' export const target15 = 15',
      '-export const target16 = 16',
      '+export const target16 = 1600',
      ' export const target17 = 17',
    ].join('\n')

    const single = buildSingleHunkGitPatch(
      remainingPatch,
      1,
      { deletionStart: 16, additionStart: 16 },
    )

    expect(single).toContain('@@ -16,1 +16,1 @@')
    expect(single).toContain('+export const target16 = 1600')
    expect(single).not.toContain('target2 = 200')
  })
})
