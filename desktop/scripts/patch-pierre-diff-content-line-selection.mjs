/**
 * @pierre/diffs only starts line-selection drags when the pointer-down hits the
 * gutter/number column. That blocks comment-on-range UX when users drag across
 * the highlighted code body.
 *
 * v1.1.x: `getSelectionPointerInfo(path, true)` on pointer-down.
 * v1.2.x: `resolveSelectionInfo(..., { requireNumberColumn: true })` in
 *          `startLineSelectionFromPointerDown`.
 *
 * Idempotent: safe to run on every install. Re-run after upgrading @pierre/diffs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const LEGACY_NEEDLE = 'getSelectionPointerInfo(path, true)'
const LEGACY_REPLACEMENT = 'getSelectionPointerInfo(path, false)'

/** Only the pointer-down path in startLineSelectionFromPointerDown (move handlers stay false). */
const V12_NEEDLE = `resolveSelectionInfo(event, {
			source: "event-path",
			requireNumberColumn: true
		})`
const V12_REPLACEMENT = `resolveSelectionInfo(event, {
			source: "event-path",
			requireNumberColumn: false
		})`

export function patchPierreDiffContentLineSelection(desktopRoot) {
  const file = join(desktopRoot, 'node_modules/@pierre/diffs/dist/managers/InteractionManager.js')
  if (!existsSync(file)) {
    console.warn('[patch-pierre-diffs] InteractionManager.js missing; skip line-selection patch')
    return
  }
  const src = readFileSync(file, 'utf8')

  if (src.includes(LEGACY_NEEDLE)) {
    const count = (src.match(/getSelectionPointerInfo\(path, true\)/g) ?? []).length
    if (count !== 1) {
      console.warn(
        `[patch-pierre-diffs] Expected 1 "${LEGACY_NEEDLE}" in InteractionManager.js, found ${count}; skip legacy patch`,
      )
      return
    }
    writeFileSync(file, src.replace(LEGACY_NEEDLE, LEGACY_REPLACEMENT), 'utf8')
    console.log('[patch-pierre-diffs] Line selection (legacy): pointer-down allows code column')
    return
  }

  if (!src.includes(V12_NEEDLE)) {
    if (src.includes('requireNumberColumn: false') && src.includes('startLineSelectionFromPointerDown')) {
      return
    }
    console.warn('[patch-pierre-diffs] No known line-selection patch target in InteractionManager.js; skip')
    return
  }

  writeFileSync(file, src.replace(V12_NEEDLE, V12_REPLACEMENT), 'utf8')
  console.log('[patch-pierre-diffs] Line selection (1.2.x): pointer-down allows code column')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  patchPierreDiffContentLineSelection(desktopRoot)
}
