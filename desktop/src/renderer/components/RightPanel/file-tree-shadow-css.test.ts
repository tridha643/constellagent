import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Smoke test for the shadow-DOM letter badge stylesheet. We can't easily
 * mount pierre/trees in Bun, so we validate the CSS source contains the
 * M/A/D/R/U rules and chains to the theme-driven git status color var
 * (never a hardcoded hex).
 */
describe('file-tree-shadow-css letter badges', () => {
  const modulePath = fileURLToPath(new URL('./file-tree-shadow-css.ts', import.meta.url))
  const source = readFileSync(modulePath, 'utf8')

  it('defines an ::after rule for every tracked git status letter', () => {
    const expected: Array<[string, string]> = [
      ['modified', 'M'],
      ['added', 'A'],
      ['deleted', 'D'],
      ['renamed', 'R'],
      ['untracked', 'U'],
    ]
    for (const [status, letter] of expected) {
      const pattern = new RegExp(
        `data-item-git-status='${status}'[^{}]*::after\\s*\\{[^}]*content:\\s*'${letter}'`,
        's',
      )
      expect(source).toMatch(pattern)
    }
  })

  it('hides pierre\'s default dot icon so the letter is the only glyph', () => {
    expect(source).toMatch(/data-icon-name='file-tree-icon-dot'\s*\]\s*\{\s*display:\s*none/)
  })

  it('routes badge color through --trees-item-git-status-color (no hardcoded hex)', () => {
    expect(source).toContain('var(--trees-item-git-status-color')
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('tints the whole name cell for every tracked git status via theme tokens', () => {
    const statuses: Array<[string, string]> = [
      ['modified', 'modified'],
      ['added', 'added'],
      ['deleted', 'deleted'],
      ['renamed', 'renamed'],
      ['untracked', 'untracked'],
    ]
    for (const [attr, token] of statuses) {
      const pattern = new RegExp(
        `data-item-git-status='${attr}'[^{}]*\\[data-item-section='name'\\]\\s*\\{[^}]*color:\\s*var\\(--trees-git-${token}-color`,
        's',
      )
      expect(source).toMatch(pattern)
    }
  })

  it('rounds the selected row into a pill and bolds the name', () => {
    expect(source).toMatch(
      /\[data-item-selected='true'\]\s*\{[^}]*border-radius:\s*var\(--trees-row-selected-radius/s,
    )
    expect(source).toMatch(
      /data-item-selected='true'[^{}]*\[data-item-section='name'\]\s*\{[^}]*font-weight:\s*600/s,
    )
  })
})
