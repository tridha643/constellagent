import type { editor } from 'monaco-editor'

export type AppearanceThemeId = 'default' | 'absolutely'

interface ThemePreview {
  surface: string
  accent: string
  ink: string
}

interface AppearanceThemePreset {
  id: AppearanceThemeId
  label: string
  description: string
  preview: ThemePreview
  cssVars: Record<string, string>
  terminalTheme: {
    background: string
    foreground: string
    cursor: string
    selectionBackground: string
    black: string
    red: string
    green: string
    yellow: string
    blue: string
    magenta: string
    cyan: string
    white: string
    brightBlack: string
    brightRed: string
    brightGreen: string
    brightYellow: string
    brightBlue: string
    brightMagenta: string
    brightCyan: string
    brightWhite: string
  }
  monacoTheme: editor.IStandaloneThemeData
  mermaidThemeVariables: Record<string, string>
}

const FONT_MONO = "'SF Mono', 'Menlo', 'Cascadia Code', 'JetBrains Mono', monospace"
const FONT_UI_DEFAULT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
const FONT_UI_ABSOLUTELY = "ui-monospace, 'SF Mono', 'Menlo', 'Cascadia Code', monospace"

const DEFAULT_THEME: AppearanceThemePreset = {
  id: 'default',
  label: 'Default',
  description: 'Constellagent dark with steel-blue accents.',
  preview: {
    surface: '#191919',
    accent: '#7B93BD',
    ink: '#eeeeee',
  },
  cssVars: {
    '--surface-0': '#111111',
    '--surface-1': '#191919',
    '--surface-2': '#212121',
    '--surface-3': '#2a2a2a',
    '--surface-4': '#333333',
    '--border-subtle': 'rgba(255, 255, 255, 0.06)',
    '--border-default': '#2e2e2e',
    '--border-strong': '#404040',
    '--border-accent': '#7B93BD',
    '--text-primary': '#eeeeee',
    '--text-secondary': '#999999',
    '--text-tertiary': '#666666',
    '--text-ghost': '#444444',
    '--text-inverse': '#111111',
    '--accent-blue': '#7B93BD',
    '--accent-blue-dim': 'rgba(123, 147, 189, 0.14)',
    '--accent-blue-glow': 'rgba(123, 147, 189, 0.06)',
    '--surface-worktree': '#222830',
    '--surface-branch': '#2a2a2a',
    '--surface-branch-active': '#1e2d42',
    '--surface-branch-hover': '#323232',
    '--surface-branch-active-hover': '#243752',
    '--accent-cyan': '#88C0D0',
    '--accent-purple': '#B48EAD',
    '--accent-purple-dim': 'rgba(180, 142, 173, 0.08)',
    '--accent-green': '#A3BE8C',
    '--accent-green-muted': '#7A9A6C',
    '--accent-green-dim': 'rgba(163, 190, 140, 0.14)',
    '--accent-red': '#BF616A',
    '--accent-red-dim': 'rgba(191, 97, 106, 0.14)',
    '--accent-orange': '#D08770',
    '--accent-orange-dim': 'rgba(208, 135, 112, 0.14)',
    '--accent-yellow': '#EBCB8B',
    '--status-neutral-1': '#a0a0a0',
    '--status-neutral-0': '#707070',
    '--status-neutral-dim': 'rgba(160, 160, 160, 0.10)',
    '--status-pending-1': '#EBCB8B',
    '--status-pending-0': '#B09A5A',
    '--status-pending-dim': 'rgba(235, 203, 139, 0.10)',
    '--status-info-1': '#7B93BD',
    '--status-info-0': '#6279A0',
    '--status-info-dim': 'rgba(123, 147, 189, 0.10)',
    '--status-danger-1': '#BF616A',
    '--status-danger-0': '#9A4E56',
    '--status-danger-dim': 'rgba(191, 97, 106, 0.10)',
    '--status-warning-1': '#D08770',
    '--status-warning-0': '#A56A58',
    '--status-warning-dim': 'rgba(208, 135, 112, 0.10)',
    '--status-success-1': '#A3BE8C',
    '--status-success-0': '#7A9A6C',
    '--status-success-dim': 'rgba(163, 190, 140, 0.10)',
    '--term-bg': '#111111',
    '--term-fg': '#eeeeee',
    '--term-cursor': '#eeeeee',
    '--term-selection': 'rgba(255, 255, 255, 0.15)',
    '--term-black': '#2a2a2a',
    '--term-red': '#BF616A',
    '--term-green': '#A3BE8C',
    '--term-yellow': '#EBCB8B',
    '--term-blue': '#81A1C1',
    '--term-magenta': '#B48EAD',
    '--term-cyan': '#88C0D0',
    '--term-white': '#eeeeee',
    '--font-mono': FONT_MONO,
    '--font-ui': FONT_UI_DEFAULT,
    '--background': '#111111',
    '--foreground': '#eeeeee',
    '--muted': '#212121',
    '--muted-foreground': '#999999',
    '--border': '#2e2e2e',
    '--primary': '#7B93BD',
    '--primary-foreground': '#eeeeee',
    '--card': '#191919',
    '--card-foreground': '#eeeeee',
    '--sidebar': '#212121',
    '--sidebar-foreground': '#eeeeee',
    '--sidebar-border': '#2e2e2e',
    '--sidebar-accent': '#2a2a2a',
    '--sidebar-accent-foreground': '#eeeeee',
    '--ring': '#7b93bd',
    '--input': '#2e2e2e',
    '--destructive': '#bf616a',
    '--secondary': '#2a2a2a',
    '--secondary-foreground': '#eeeeee',
    '--accent': '#2a2a2a',
    '--accent-foreground': '#eeeeee',
  },
  terminalTheme: {
    background: '#111111',
    foreground: '#eeeeee',
    cursor: '#eeeeee',
    selectionBackground: 'rgba(255, 255, 255, 0.15)',
    black: '#2a2a2a',
    red: '#BF616A',
    green: '#A3BE8C',
    yellow: '#EBCB8B',
    blue: '#81A1C1',
    magenta: '#B48EAD',
    cyan: '#88C0D0',
    white: '#eeeeee',
    brightBlack: '#505050',
    brightRed: '#D08770',
    brightGreen: '#B4C99A',
    brightYellow: '#F5DDA0',
    brightBlue: '#8FAFD7',
    brightMagenta: '#C49BBF',
    brightCyan: '#9DD0DE',
    brightWhite: '#fafafa',
  },
  monacoTheme: {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#111111',
      'editor.foreground': '#eeeeee',
      'editorLineNumber.foreground': '#666666',
      'editorLineNumber.activeForeground': '#999999',
      'editorCursor.foreground': '#eeeeee',
      'editor.selectionBackground': '#2a2f38',
      'editor.lineHighlightBackground': '#1a1a1a',
      'editorIndentGuide.background1': '#2e2e2e',
      'editorIndentGuide.activeBackground1': '#404040',
      'editorWidget.background': '#212121',
      'editorHoverWidget.background': '#212121',
      'editorGutter.background': '#111111',
      'diffEditor.insertedTextBackground': 'rgba(163, 190, 140, 0.22)',
      'diffEditor.removedTextBackground': 'rgba(191, 97, 106, 0.22)',
      'diffEditor.insertedLineBackground': 'rgba(163, 190, 140, 0.08)',
      'diffEditor.removedLineBackground': 'rgba(191, 97, 106, 0.08)',
      'diffEditorGutter.insertedLineBackground': 'rgba(163, 190, 140, 0.14)',
      'diffEditorGutter.removedLineBackground': 'rgba(191, 97, 106, 0.14)',
      'diffEditorOverview.insertedForeground': 'rgba(163, 190, 140, 0.55)',
      'diffEditorOverview.removedForeground': 'rgba(191, 97, 106, 0.55)',
      'diffEditor.border': '#00000000',
      'diffEditor.diagonalFill': 'rgba(255, 255, 255, 0.03)',
    },
  },
  mermaidThemeVariables: {
    primaryColor: '#7B93BD',
    primaryTextColor: '#eeeeee',
    primaryBorderColor: '#2e2e2e',
    lineColor: '#999999',
    secondaryColor: '#88C0D0',
    tertiaryColor: '#B48EAD',
  },
}

const ABSOLUTELY_THEME: AppearanceThemePreset = {
  id: 'absolutely',
  label: 'Absolutely',
  description: 'Warm graphite surfaces with a monospace UI and clay accent.',
  preview: {
    surface: '#2d2d2b',
    accent: '#cc7d5e',
    ink: '#f9f9f7',
  },
  cssVars: {
    '--surface-0': '#242422',
    '--surface-1': '#2d2d2b',
    '--surface-2': '#343432',
    '--surface-3': '#3b3b39',
    '--surface-4': '#474744',
    '--border-subtle': 'rgba(249, 249, 247, 0.08)',
    '--border-default': '#4b4b47',
    '--border-strong': '#61615b',
    '--border-accent': '#cc7d5e',
    '--text-primary': '#f9f9f7',
    '--text-secondary': '#d3d2cc',
    '--text-tertiary': '#9f9e97',
    '--text-ghost': '#716f69',
    '--text-inverse': '#232321',
    '--accent-blue': '#cc7d5e',
    '--accent-blue-dim': 'rgba(204, 125, 94, 0.18)',
    '--accent-blue-glow': 'rgba(204, 125, 94, 0.10)',
    '--surface-worktree': '#322d29',
    '--surface-branch': '#3a3531',
    '--surface-branch-active': '#553d33',
    '--surface-branch-hover': '#433d39',
    '--surface-branch-active-hover': '#61453a',
    '--accent-cyan': '#8bb8a8',
    '--accent-purple': '#b292b0',
    '--accent-purple-dim': 'rgba(178, 146, 176, 0.12)',
    '--accent-green': '#00c853',
    '--accent-green-muted': '#3ea66a',
    '--accent-green-dim': 'rgba(0, 200, 83, 0.16)',
    '--accent-red': '#ff5f38',
    '--accent-red-dim': 'rgba(255, 95, 56, 0.18)',
    '--accent-orange': '#cc7d5e',
    '--accent-orange-dim': 'rgba(204, 125, 94, 0.18)',
    '--accent-yellow': '#e5b567',
    '--status-neutral-1': '#c1c0ba',
    '--status-neutral-0': '#8b8a84',
    '--status-neutral-dim': 'rgba(193, 192, 186, 0.10)',
    '--status-pending-1': '#e5b567',
    '--status-pending-0': '#bc9151',
    '--status-pending-dim': 'rgba(229, 181, 103, 0.12)',
    '--status-info-1': '#cc7d5e',
    '--status-info-0': '#a86349',
    '--status-info-dim': 'rgba(204, 125, 94, 0.12)',
    '--status-danger-1': '#ff5f38',
    '--status-danger-0': '#c74e30',
    '--status-danger-dim': 'rgba(255, 95, 56, 0.14)',
    '--status-warning-1': '#e5b567',
    '--status-warning-0': '#b78b4f',
    '--status-warning-dim': 'rgba(229, 181, 103, 0.12)',
    '--status-success-1': '#00c853',
    '--status-success-0': '#2f9d5c',
    '--status-success-dim': 'rgba(0, 200, 83, 0.14)',
    '--term-bg': '#242422',
    '--term-fg': '#f9f9f7',
    '--term-cursor': '#f9f9f7',
    '--term-selection': 'rgba(249, 249, 247, 0.14)',
    '--term-black': '#3b3b39',
    '--term-red': '#ff5f38',
    '--term-green': '#00c853',
    '--term-yellow': '#e5b567',
    '--term-blue': '#cc7d5e',
    '--term-magenta': '#b292b0',
    '--term-cyan': '#8bb8a8',
    '--term-white': '#f9f9f7',
    '--font-mono': FONT_MONO,
    '--font-ui': FONT_UI_ABSOLUTELY,
    '--background': '#242422',
    '--foreground': '#f9f9f7',
    '--muted': '#343432',
    '--muted-foreground': '#9f9e97',
    '--border': '#4b4b47',
    '--primary': '#cc7d5e',
    '--primary-foreground': '#232321',
    '--card': '#2d2d2b',
    '--card-foreground': '#f9f9f7',
    '--sidebar': '#2d2d2b',
    '--sidebar-foreground': '#f9f9f7',
    '--sidebar-border': '#4b4b47',
    '--sidebar-accent': '#3b3b39',
    '--sidebar-accent-foreground': '#f9f9f7',
    '--ring': '#cc7d5e',
    '--input': '#4b4b47',
    '--destructive': '#ff5f38',
    '--secondary': '#3b3b39',
    '--secondary-foreground': '#f9f9f7',
    '--accent': '#3b3b39',
    '--accent-foreground': '#f9f9f7',
  },
  terminalTheme: {
    background: '#242422',
    foreground: '#f9f9f7',
    cursor: '#f9f9f7',
    selectionBackground: 'rgba(249, 249, 247, 0.14)',
    black: '#3b3b39',
    red: '#ff5f38',
    green: '#00c853',
    yellow: '#e5b567',
    blue: '#cc7d5e',
    magenta: '#b292b0',
    cyan: '#8bb8a8',
    white: '#f9f9f7',
    brightBlack: '#62615d',
    brightRed: '#ff8a66',
    brightGreen: '#52df84',
    brightYellow: '#f1c980',
    brightBlue: '#d99679',
    brightMagenta: '#c0a5bf',
    brightCyan: '#9ecabb',
    brightWhite: '#ffffff',
  },
  monacoTheme: {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#242422',
      'editor.foreground': '#f9f9f7',
      'editorLineNumber.foreground': '#716f69',
      'editorLineNumber.activeForeground': '#d3d2cc',
      'editorCursor.foreground': '#f9f9f7',
      'editor.selectionBackground': '#4a3c35',
      'editor.lineHighlightBackground': '#2d2d2b',
      'editorIndentGuide.background1': '#4b4b47',
      'editorIndentGuide.activeBackground1': '#61615b',
      'editorWidget.background': '#343432',
      'editorHoverWidget.background': '#343432',
      'editorGutter.background': '#242422',
      'diffEditor.insertedTextBackground': 'rgba(139, 184, 168, 0.24)',
      'diffEditor.removedTextBackground': 'rgba(204, 125, 94, 0.24)',
      'diffEditor.insertedLineBackground': 'rgba(139, 184, 168, 0.09)',
      'diffEditor.removedLineBackground': 'rgba(204, 125, 94, 0.09)',
      'diffEditorGutter.insertedLineBackground': 'rgba(139, 184, 168, 0.16)',
      'diffEditorGutter.removedLineBackground': 'rgba(204, 125, 94, 0.16)',
      'diffEditorOverview.insertedForeground': 'rgba(139, 184, 168, 0.55)',
      'diffEditorOverview.removedForeground': 'rgba(204, 125, 94, 0.55)',
      'diffEditor.border': '#00000000',
      'diffEditor.diagonalFill': 'rgba(255, 255, 255, 0.03)',
    },
  },
  mermaidThemeVariables: {
    primaryColor: '#cc7d5e',
    primaryTextColor: '#f9f9f7',
    primaryBorderColor: '#4b4b47',
    lineColor: '#d3d2cc',
    secondaryColor: '#8bb8a8',
    tertiaryColor: '#b292b0',
  },
}

const THEMES: Record<AppearanceThemeId, AppearanceThemePreset> = {
  default: DEFAULT_THEME,
  absolutely: ABSOLUTELY_THEME,
}

export const APPEARANCE_THEME_OPTIONS = Object.values(THEMES).map((theme) => ({
  id: theme.id,
  label: theme.label,
  description: theme.description,
  preview: theme.preview,
}))

export function getAppearanceTheme(themeId: AppearanceThemeId): AppearanceThemePreset {
  return THEMES[themeId] ?? THEMES.default
}

export function getAppearanceTerminalTheme(themeId: AppearanceThemeId) {
  return getAppearanceTheme(themeId).terminalTheme
}

export function getAppearanceMonacoThemeName(themeId: AppearanceThemeId): string {
  return `constellagent-${themeId}`
}

export function ensureAppearanceMonacoThemes(monaco: typeof editor) {
  for (const theme of Object.values(THEMES)) {
    monaco.defineTheme(getAppearanceMonacoThemeName(theme.id), theme.monacoTheme)
  }
}

export function getAppearanceMermaidThemeVariables(themeId: AppearanceThemeId) {
  return getAppearanceTheme(themeId).mermaidThemeVariables
}

export function applyAppearanceTheme(themeId: AppearanceThemeId, root: HTMLElement = document.documentElement) {
  const theme = getAppearanceTheme(themeId)
  root.dataset.appearanceTheme = theme.id
  for (const [key, value] of Object.entries(theme.cssVars)) {
    root.style.setProperty(key, value)
  }
}
