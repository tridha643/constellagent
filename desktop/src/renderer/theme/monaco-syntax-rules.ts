import type { editor } from 'monaco-editor'

/** Aligned with AppearanceThemeId in appearance.ts (kept local to avoid circular imports). */
export type MonacoSyntaxThemeId = 'default' | 'absolutely'

type MonacoRule = editor.ITokenThemeRule

/**
 * Cursor / VS Code Dark+ adjacent palette for Monarch (syntactic) + semantic tokens.
 *
 * Monarch cannot split `keyword` into control vs storage; we bias toward Dark+ purple
 * (`#C586C0`) like Cursor. Semantic highlighting separates `function` / `property` /
 * `class` etc. once the TS worker attaches (see `'semanticHighlighting.enabled': true`).
 *
 * References: https://github.com/microsoft/vscode/blob/main/extensions/theme-defaults/themes/dark_plus.json
 */
const CURSOR_DARK_PLUS: {
  keyword: string
  typeIdent: string
  identifier: string
  string: string
  number: string
  regexp: string
  regexpEscape: string
  comment: string
  delim: string
  jsonKey: string
  jsonBoolean: string
} = {
  keyword: '#C586C0',
  typeIdent: '#4EC9B0',
  identifier: '#9CDCFE',
  string: '#CE9178',
  number: '#B5CEA8',
  regexp: '#D16969',
  regexpEscape: '#D7BA7D',
  comment: '#6A9955',
  delim: '#D4D4D4',
  jsonKey: '#9CDCFE',
  jsonBoolean: '#569CD6',
}

/** Absolutely uses the same saturated syntax — UI chrome differs via `appearance.ts` surfaces. */
const PALETTE_SYNTHACTIC = {
  default: CURSOR_DARK_PLUS,
  absolutely: CURSOR_DARK_PLUS,
}

/** Semantic token rules (Legend types from TypeScript `/ vscode-languageserver-types`). */
function semanticTokenRules(cursor: typeof CURSOR_DARK_PLUS): MonacoRule[] {
  const funcBlue = '#4FC1FF'
  const teal = '#4EC9B0'
  const varBlue = '#9CDCFE'
  return [
    { token: 'namespace', foreground: teal },
    { token: 'type', foreground: teal },
    { token: 'class', foreground: teal },
    { token: 'enum', foreground: teal },
    { token: 'interface', foreground: teal },
    { token: 'struct', foreground: teal },
    { token: 'typeParameter', foreground: teal },
    { token: 'function', foreground: funcBlue },
    { token: 'method', foreground: funcBlue },
    { token: 'member', foreground: funcBlue },
    { token: 'macro', foreground: funcBlue },
    { token: 'property', foreground: varBlue },
    { token: 'enumMember', foreground: funcBlue },
    { token: 'variable', foreground: varBlue },
    { token: 'parameter', foreground: varBlue },
    { token: 'event', foreground: varBlue },
    { token: 'label', foreground: '#C8C8C8' },
    { token: 'comment', foreground: cursor.comment },
    { token: 'string', foreground: cursor.string },
    { token: 'number', foreground: cursor.number },
    { token: 'regexp', foreground: cursor.regexp },
    { token: 'operator', foreground: cursor.delim },
    // Declaration modifiers (`foo` in `function foo`)
    { token: 'function.declaration', foreground: funcBlue },
    { token: 'method.declaration', foreground: funcBlue },
    { token: 'class.declaration', foreground: teal },
    { token: 'interface.declaration', foreground: teal },
    { token: 'type.declaration', foreground: teal },
    { token: 'namespace.declaration', foreground: teal },
    { token: 'variable.declaration', foreground: varBlue },
    { token: 'parameter.declaration', foreground: varBlue },
  ]
}

export function getMonacoSyntaxRules(themeId: MonacoSyntaxThemeId): MonacoRule[] {
  const c = PALETTE_SYNTHACTIC[themeId] ?? PALETTE_SYNTHACTIC.default

  const synth: MonacoRule[] = [
    // JSON — monaco/language/json/tokenization.js
    { token: 'string.key.json', foreground: c.jsonKey },
    { token: 'string.value.json', foreground: c.string },
    { token: 'keyword.json', foreground: c.jsonBoolean },
    { token: 'number.json', foreground: c.number },
    { token: 'delimiter.bracket.json', foreground: c.delim },
    { token: 'delimiter.array.json', foreground: c.delim },
    { token: 'delimiter.colon.json', foreground: c.delim },
    { token: 'delimiter.comma.json', foreground: c.delim },
    { token: 'comment.line.json', foreground: c.comment },
    { token: 'comment.block.json', foreground: c.comment },

    // TS/JS Monarch — basic-languages/typescript
    { token: 'keyword', foreground: c.keyword },
    { token: 'keyword.ts', foreground: c.keyword },
    { token: 'type.identifier', foreground: c.typeIdent },
    { token: 'type.identifier.ts', foreground: c.typeIdent },
    { token: 'identifier', foreground: c.identifier },
    { token: 'identifier.ts', foreground: c.identifier },
    { token: 'string', foreground: c.string },
    { token: 'string.ts', foreground: c.string },
    { token: 'string.escape', foreground: c.regexpEscape },
    { token: 'string.invalid', foreground: '#F14C4C' },
    { token: 'number', foreground: c.number },
    { token: 'number.float', foreground: c.number },
    { token: 'number.hex', foreground: c.number },
    { token: 'number.octal', foreground: c.number },
    { token: 'number.binary', foreground: c.number },
    { token: 'regexp', foreground: c.regexp },
    { token: 'regexp.escape', foreground: c.regexpEscape },
    { token: 'regexp.escape.control', foreground: c.regexp },
    { token: 'regexp.invalid', foreground: '#F14C4C' },
    { token: 'keyword.other', foreground: '#D7BA7D' },
    { token: 'delimiter.bracket', foreground: c.delim },
    { token: 'delimiter', foreground: c.delim },
    { token: 'comment', foreground: c.comment },
    { token: 'comment.doc', foreground: c.comment },
    { token: 'annotation', foreground: c.typeIdent },
  ]

  return [...synth, ...semanticTokenRules(c)]
}
