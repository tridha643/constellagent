import pierreDark from '@pierre/theme/pierre-dark'

/** Must match Shiki/Pierre resolved theme id (see registerPierreThemes). */
export const CODEX_ABSOLUTELY_DIFF_THEME_ID = 'codex-absolutely-dark' as const

/**
 * Codex “Absolutely” dark accent `#CC7D5E`, with **readable** TS/JSON coloring:
 * teal property keys, pink/magenta strings, white booleans/null, aqua numbers,
 * gold bracket punctuation, lavender keywords — aligned with Monaco editor palettes.
 */
const colorOverrides: Record<string, string> = {
  'editor.background': '#141416',
  'editor.foreground': '#f0efe9',

  'editorLineNumber.foreground': '#65656b',
  'editorLineNumber.activeForeground': '#b4b4bc',

  'focusBorder': '#CC7D5E',
  'editorCursor.foreground': '#CC7D5E',
  'tab.activeBorderTop': '#CC7D5E',
  'panelTitle.activeBorder': '#CC7D5E',
  'textLink.foreground': '#CC7D5E',
  'textLink.activeForeground': '#e8a882',
  'button.background': '#CC7D5E',
  'button.foreground': '#141414',
  'button.hoverBackground': '#b56d52',

  'gitDecoration.addedResourceForeground': '#34d058',
  'gitDecoration.deletedResourceForeground': '#ff5a5a',
  'gitDecoration.modifiedResourceForeground': '#6cb6ff',

  'diffEditor.insertedTextBackground': '#34d05828',
  'diffEditor.removedTextBackground': '#ff5a5a28',

  'terminal.ansiGreen': '#34d058',
  'terminal.ansiRed': '#ff5a5a',
}

/**
 * Appended after Pierre so these win. JSON uses TextMate scopes; TS/JS uses broad
 * fallbacks — specific `meta.structure.dictionary.key.json` beats generic `string.quoted`.
 */
const tokenColorOverrides = [
  {
    scope: ['meta.structure.dictionary.key.json string.quoted.double.json'],
    settings: { foreground: '#5ed4cf' },
  },
  {
    scope: ['support.type.property-name.json'],
    settings: { foreground: '#5ed4cf' },
  },
  { scope: ['string.quoted.double.json'], settings: { foreground: '#e9b0d9' } },
  {
    scope: ['constant.numeric', 'constant.numeric.json', 'constant.character.numeric'],
    settings: { foreground: '#6fe8ff' },
  },
  {
    scope: [
      'constant.language.json',
      'constant.language.boolean.json',
      'constant.language.boolean',
      'constant.language.null.json',
    ],
    settings: { foreground: '#f0efe9' },
  },
  { scope: ['keyword', 'keyword.control', 'storage', 'storage.type', 'storage.modifier'], settings: { foreground: '#d4afff' } },
  { scope: ['entity.name.type', 'entity.name.class', 'support.type'], settings: { foreground: '#d4afff' } },
  { scope: ['string', 'constant.other.symbol', 'string.quoted'], settings: { foreground: '#e9b0d9' } },
  {
    scope: [
      'meta.brace',
      'punctuation.section.block.begin',
      'punctuation.section.block.end',
      'punctuation.definition.block',
      'punctuation.definition.dict.begin.json',
      'punctuation.definition.dict.end.json',
      'punctuation.definition.array.begin.json',
      'punctuation.definition.array.end.json',
    ],
    settings: { foreground: '#f0cf5f' },
  },
  {
    scope: [
      'keyword.operator',
      'keyword.operator.logical',
      'keyword.operator.arithmetic',
      'keyword.operator.comparison',
      'keyword.operator.relational',
    ],
    settings: { foreground: '#d7dce4' },
  },
  {
    scope: ['variable', 'variable.other.readwrite', 'meta.object-literal.key', 'support.variable.property'],
    settings: { foreground: '#5ed4cf' },
  },
  {
    scope: ['entity.name.function', 'support.function', 'meta.function-call'],
    settings: { foreground: '#6cb6ff' },
  },
  { scope: ['punctuation.separator', 'punctuation.terminator', 'punctuation.accessor'], settings: { foreground: '#e6e8e4' } },
  { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#8b8d94' } },
] as const

const semanticTokenColorOverrides = {
  comment: '#8b8d94',
  string: '#e9b0d9',
  number: '#6fe8ff',
  keyword: '#d4afff',
  variable: '#c8c4bc',
  parameter: '#b1bac4',
  property: '#5ed4cf',
  function: '#6cb6ff',
  method: '#6cb6ff',
  type: '#d4afff',
  class: '#d4afff',
}

const codexAbsolutelyDark = {
  ...pierreDark,
  name: CODEX_ABSOLUTELY_DIFF_THEME_ID,
  colors: {
    ...pierreDark.colors,
    ...colorOverrides,
  },
  tokenColors: [...pierreDark.tokenColors, ...tokenColorOverrides],
  semanticTokenColors: {
    ...pierreDark.semanticTokenColors,
    ...semanticTokenColorOverrides,
  },
}

export default codexAbsolutelyDark
