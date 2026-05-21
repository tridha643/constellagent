import { useMemo } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import { CODEX_ABSOLUTELY_DIFF_THEME_ID } from '../../../../themes/diff/codex-absolutely-dark'
import styles from '../../Conductor.module.css'

const DIFFS_THEME = CODEX_ABSOLUTELY_DIFF_THEME_ID

/** Compact Pierre unified diff for Conductor tool expand bodies (no annotations). */
export function ConductorPierreDiff({ patch }: { patch: string }) {
  const options = useMemo(
    () => ({
      theme: DIFFS_THEME,
      themeType: 'dark' as const,
      diffStyle: 'unified' as const,
      diffIndicators: 'bars' as const,
      lineDiffType: 'word-alt' as const,
      overflow: 'scroll' as const,
      expandUnchanged: false,
      disableFileHeader: true,
      enableLineSelection: false,
    }),
    [],
  )

  if (!patch.trim()) {
    return null
  }

  return (
    <div className={styles.conductorPierreDiff} data-testid="conductor-pierre-diff">
      <PatchDiff patch={patch} options={options} />
    </div>
  )
}
