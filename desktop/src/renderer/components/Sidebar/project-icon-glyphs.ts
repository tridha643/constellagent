import {
  Box,
  Cloud,
  Code,
  Cpu,
  Database,
  Folder as FolderIcon,
  Globe,
  Layers,
  Package,
  Palette,
  Rocket,
  Server,
  Star,
  Terminal,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { DEFAULT_PROJECT_ICON_GLYPH } from '../../../shared/project-icon-templates'

/** Bundled template glyph id → Lucide component (see project-icon-templates.ts). */
export const PROJECT_ICON_COMPONENTS: Record<string, LucideIcon> = {
  folder: FolderIcon,
  code: Code,
  terminal: Terminal,
  box: Box,
  package: Package,
  rocket: Rocket,
  zap: Zap,
  star: Star,
  globe: Globe,
  cloud: Cloud,
  server: Server,
  database: Database,
  cpu: Cpu,
  layers: Layers,
  wrench: Wrench,
  palette: Palette,
}

/** Resolve a glyph id to its Lucide component, falling back to the default. */
export function getProjectIconComponent(glyph: string): LucideIcon {
  return PROJECT_ICON_COMPONENTS[glyph] ?? PROJECT_ICON_COMPONENTS[DEFAULT_PROJECT_ICON_GLYPH]
}
