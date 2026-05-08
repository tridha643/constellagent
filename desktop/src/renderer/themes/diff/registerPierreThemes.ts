import { registerCustomTheme } from '@pierre/diffs'
import codexAbsolutelyDarkTheme, { CODEX_ABSOLUTELY_DIFF_THEME_ID } from './codex-absolutely-dark'

registerCustomTheme(CODEX_ABSOLUTELY_DIFF_THEME_ID, async () => ({
  ...codexAbsolutelyDarkTheme,
  name: CODEX_ABSOLUTELY_DIFF_THEME_ID,
}))
