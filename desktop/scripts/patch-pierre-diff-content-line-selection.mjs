/**
 * @pierre/diffs only starts line-selection drags when the pointer-down hits the
 * gutter/number column (`getSelectionPointerInfo(path, true)`). That blocks
 * comment-on-range UX when users drag across the highlighted code body.
 * Relax the initial hit-test to match document pointer-move (`... false`).
 *
 * Idempotent: safe to run on every install. Re-run after upgrading @pierre/diffs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NEEDLE = 'getSelectionPointerInfo(path, true)'
const REPLACEMENT = 'getSelectionPointerInfo(path, false)'

export function patchPierreDiffContentLineSelection(desktopRoot) {
  const file = join(desktopRoot, 'node_modules/@pierre/diffs/dist/managers/InteractionManager.js')
  if (!existsSync(file)) {
    console.warn('[patch-pierre-diffs] InteractionManager.js missing; skip line-selection patch')
    return
  }
  const src = readFileSync(file, 'utf8')
  if (!src.includes(NEEDLE)) return
  const count = (src.match(/getSelectionPointerInfo\(path, true\)/g) ?? []).length
  if (count !== 1) {
    console.warn(
      `[patch-pierre-diffs] Expected 1 "${NEEDLE}" in InteractionManager.js, found ${count}; skip`,
    )
    return
  }
  writeFileSync(file, src.replace(NEEDLE, REPLACEMENT), 'utf8')
  console.log('[patch-pierre-diffs] Line selection: pointer-down allows code column (not only line numbers)')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  patchPierreDiffContentLineSelection(desktopRoot)
}
