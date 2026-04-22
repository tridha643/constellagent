import type { PanelType, Side } from '../store/types'

export const CONSTELLAGENT_PANEL_MIME = 'application/x-constellagent-panel'

export interface PanelDockDrag {
  panel: PanelType
  side: Side
}

const PANEL_TYPES: PanelType[] = ['project', 'files', 'changes', 'graph']
const SIDES: Side[] = ['left', 'right']

function isPanelType(value: unknown): value is PanelType {
  return typeof value === 'string' && PANEL_TYPES.includes(value as PanelType)
}

function isSide(value: unknown): value is Side {
  return typeof value === 'string' && SIDES.includes(value as Side)
}

export function encodePanelDockDrag(payload: PanelDockDrag): string {
  return JSON.stringify(payload)
}

export function decodePanelDockDrag(raw: string | null | undefined): PanelDockDrag | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!isPanelType(parsed.panel) || !isSide(parsed.side)) return null
    return { panel: parsed.panel, side: parsed.side }
  } catch {
    return null
  }
}

export function writePanelDockDrag(dataTransfer: DataTransfer, payload: PanelDockDrag): void {
  const raw = encodePanelDockDrag(payload)
  dataTransfer.setData(CONSTELLAGENT_PANEL_MIME, raw)
  dataTransfer.setData('text/plain', raw)
  dataTransfer.effectAllowed = 'move'
}

export function readPanelDockDrag(dataTransfer: DataTransfer | null | undefined): PanelDockDrag | null {
  if (!dataTransfer) return null
  return decodePanelDockDrag(dataTransfer.getData(CONSTELLAGENT_PANEL_MIME))
}

export function hasPanelDockDragType(dataTransfer: DataTransfer | null | undefined): boolean {
  return Boolean(dataTransfer?.types?.includes(CONSTELLAGENT_PANEL_MIME))
}
