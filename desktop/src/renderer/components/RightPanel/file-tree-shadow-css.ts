/**
 * Stylesheet injected into pierre/trees' shadow root to render M/A/D/R/U
 * letter badges in place of pierre's default colored dot on changed rows.
 *
 * All colors resolve through pierre's own `--trees-item-git-status-color`
 * cascade (which we re-point at our theme preset's `--accent-*` tokens
 * in RightPanel.module.css), so this file ships zero theme-specific hex.
 */

const LETTER_BADGE_CSS = `
:host {
  --trees-git-lane-width-override: 22px;
}

[data-item-git-status] [data-item-section='git'] {
  font-family: var(--trees-font-family);
}

[data-item-git-status] [data-item-section='git'] [data-icon-name='file-tree-icon-dot'] {
  display: none;
}

[data-item-git-status] [data-item-section='git'] > span::after {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 12px;
  font-size: 10px;
  line-height: 1;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--trees-item-git-status-color, currentColor);
}

[data-item-git-status='modified']  [data-item-section='git'] > span::after { content: 'M'; }
[data-item-git-status='added']     [data-item-section='git'] > span::after { content: 'A'; }
[data-item-git-status='deleted']   [data-item-section='git'] > span::after { content: 'D'; }
[data-item-git-status='renamed']   [data-item-section='git'] > span::after { content: 'R'; }
[data-item-git-status='untracked'] [data-item-section='git'] > span::after { content: 'U'; }

/* Whole-row color tint per git status — the name cell picks up the same theme
   token we use for the letter badge, so a modified row reads as orange top to
   bottom. All colors still chain through pierre's --trees-git-*-color. */
[data-item-git-status='modified']  [data-item-section='name'] {
  color: var(--trees-git-modified-color, currentColor);
  font-weight: 500;
}
[data-item-git-status='added']     [data-item-section='name'] {
  color: var(--trees-git-added-color, currentColor);
  font-weight: 500;
}
[data-item-git-status='deleted']   [data-item-section='name'] {
  color: var(--trees-git-deleted-color, currentColor);
  font-weight: 500;
  text-decoration: line-through;
}
[data-item-git-status='renamed']   [data-item-section='name'] {
  color: var(--trees-git-renamed-color, currentColor);
  font-weight: 500;
}
[data-item-git-status='untracked'] [data-item-section='name'] {
  color: var(--trees-git-untracked-color, currentColor);
  font-weight: 500;
}

/* Selected row: pill shape (background comes from --trees-selected-bg-override) */
[data-item-selected='true'] {
  border-radius: var(--trees-row-selected-radius, var(--radius-md));
}

[data-item-selected='true'] [data-item-section='name'] {
  font-weight: 600;
}
`

let cachedSheet: CSSStyleSheet | null = null

function getLetterBadgeSheet(): CSSStyleSheet | null {
  if (typeof CSSStyleSheet === 'undefined') return null
  if (cachedSheet) return cachedSheet
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(LETTER_BADGE_CSS)
    cachedSheet = sheet
    return sheet
  } catch {
    return null
  }
}

/**
 * Attach the letter-badge stylesheet to the given shadow root if it isn't
 * already attached. Safe to call repeatedly (idempotent).
 */
export function ensureLetterBadgeSheet(root: ShadowRoot | null | undefined): void {
  if (!root) return
  const sheet = getLetterBadgeSheet()
  if (!sheet) return
  if (root.adoptedStyleSheets.includes(sheet)) return
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
}

/**
 * Find the shadow root of pierre/trees' host element by walking up from any
 * descendant node inside it, or by probing the tree container for a shadow
 * host child. Returns null if not yet attached.
 */
export function findTreeShadowRoot(container: HTMLElement | null): ShadowRoot | null {
  if (!container) return null

  const hosts = container.querySelectorAll<HTMLElement>('*')
  for (const host of [container, ...Array.from(hosts)]) {
    const root = (host as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot
    if (root) return root
  }
  return null
}
