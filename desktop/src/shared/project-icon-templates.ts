/**
 * Shared catalog for the per-project icon override "template" mode: a bundled
 * set of Lucide glyphs + theme accent-color swatches (no binary assets). The
 * renderer maps `glyph` ids to Lucide components; the main process never needs
 * these (custom PNGs are handled by `project-icon-service.ts`).
 *
 * Source of truth for both the picker UI (ProjectSettingsDialog) and the header
 * renderer (ProjectHeaderGlyph). Kept in `shared/` so a catalog-integrity test
 * can assert the defaults resolve against the option lists.
 */

export interface ProjectIconGlyphOption {
  /** Lucide kebab-case id; must have a matching component in the renderer map. */
  readonly id: string
  /** Human label for the picker. */
  readonly label: string
}

export interface ProjectIconColorOption {
  /** Stable id stored nowhere directly; selection persists the `var` value. */
  readonly id: string
  readonly label: string
  /** CSS value applied as the glyph color (a theme accent custom property). */
  readonly var: string
}

export const PROJECT_ICON_GLYPHS: readonly ProjectIconGlyphOption[] = [
  { id: 'folder', label: 'Folder' },
  { id: 'code', label: 'Code' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'box', label: 'Box' },
  { id: 'package', label: 'Package' },
  { id: 'rocket', label: 'Rocket' },
  { id: 'zap', label: 'Zap' },
  { id: 'star', label: 'Star' },
  { id: 'globe', label: 'Globe' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'server', label: 'Server' },
  { id: 'database', label: 'Database' },
  { id: 'cpu', label: 'Chip' },
  { id: 'layers', label: 'Layers' },
  { id: 'wrench', label: 'Wrench' },
  { id: 'palette', label: 'Palette' },
]

export const PROJECT_ICON_COLORS: readonly ProjectIconColorOption[] = [
  { id: 'blue', label: 'Blue', var: 'var(--accent-blue)' },
  { id: 'cyan', label: 'Cyan', var: 'var(--accent-cyan)' },
  { id: 'purple', label: 'Purple', var: 'var(--accent-purple)' },
  { id: 'green', label: 'Green', var: 'var(--accent-green)' },
  { id: 'red', label: 'Red', var: 'var(--accent-red)' },
  { id: 'orange', label: 'Orange', var: 'var(--accent-orange)' },
  { id: 'yellow', label: 'Yellow', var: 'var(--accent-yellow)' },
]

export const DEFAULT_PROJECT_ICON_GLYPH = 'folder'
export const DEFAULT_PROJECT_ICON_COLOR = 'var(--accent-blue)'

/** Whether a glyph id is part of the bundled catalog (renderable). */
export function isProjectIconGlyph(id: string): boolean {
  return PROJECT_ICON_GLYPHS.some((glyph) => glyph.id === id)
}

/** Whether a color value is one of the catalog accent swatches. */
export function isProjectIconColor(value: string): boolean {
  return PROJECT_ICON_COLORS.some((color) => color.var === value)
}
