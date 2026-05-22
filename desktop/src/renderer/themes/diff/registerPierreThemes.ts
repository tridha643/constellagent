import { registerCustomTheme } from '@pierre/diffs'
import type { ThemeRegistrationResolved } from '@pierre/diffs'
import codexAbsolutelyDarkTheme, { CODEX_ABSOLUTELY_DIFF_THEME_ID } from './codex-absolutely-dark'

registerCustomTheme(CODEX_ABSOLUTELY_DIFF_THEME_ID, async () => ({
  ...(codexAbsolutelyDarkTheme as unknown as ThemeRegistrationResolved),
  name: CODEX_ABSOLUTELY_DIFF_THEME_ID,
}))
