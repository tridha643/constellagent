import type { PanelType, Side, SidePanelLayout, SidePanelState } from './types'
import { DEFAULT_SIDE_PANEL_LAYOUT, NAVIGATION_PANEL_TYPES, SIDE_PANEL_TYPES } from './types'

const LEGACY_NAVIGATION_PANEL_TYPES = new Set<PanelType>(NAVIGATION_PANEL_TYPES)

const DEFAULT_PANEL_SIDE: Record<PanelType, Side> = {
  project: 'left',
  files: 'right',
  changes: 'right',
  graph: 'right',
  browser: 'right',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isPanelType(value: unknown): value is PanelType {
  return typeof value === 'string' && (SIDE_PANEL_TYPES as string[]).includes(value)
}

function uniquePanelOrder(raw: unknown): PanelType[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<PanelType>()
  const order: PanelType[] = []
  for (const value of raw) {
    if (!isPanelType(value) || seen.has(value)) continue
    seen.add(value)
    order.push(value)
  }
  return order
}

function normalizeSideState(raw: unknown, defaults: SidePanelState): SidePanelState {
  const record = isRecord(raw) ? raw : null
  const panelOrder = uniquePanelOrder(record?.panelOrder)
  const activePanel = isPanelType(record?.activePanel) ? record.activePanel : defaults.activePanel
  return {
    open: typeof record?.open === 'boolean' ? record.open : defaults.open,
    activePanel,
    panelOrder,
  }
}

export function normalizeSidePanelLayout(raw: unknown): SidePanelLayout {
  const record = isRecord(raw) ? raw : null
  const left = normalizeSideState(record?.left, DEFAULT_SIDE_PANEL_LAYOUT.left)
  const right = normalizeSideState(record?.right, DEFAULT_SIDE_PANEL_LAYOUT.right)

  const seen = new Set<PanelType>()
  const leftOrder = left.panelOrder.filter((panel) => {
    if (seen.has(panel)) return false
    seen.add(panel)
    return true
  })
  const rightOrder = right.panelOrder.filter((panel) => {
    if (seen.has(panel)) return false
    seen.add(panel)
    return true
  })

  for (const panel of SIDE_PANEL_TYPES) {
    if (seen.has(panel)) continue
    const side = DEFAULT_PANEL_SIDE[panel]
    if (side === 'left') leftOrder.push(panel)
    else rightOrder.push(panel)
  }

  return {
    left: {
      open: left.open,
      activePanel: leftOrder.includes(left.activePanel) ? left.activePanel : (leftOrder[0] ?? DEFAULT_SIDE_PANEL_LAYOUT.left.activePanel),
      panelOrder: leftOrder,
    },
    right: {
      open: right.open,
      activePanel: rightOrder.includes(right.activePanel) ? right.activePanel : (rightOrder[0] ?? DEFAULT_SIDE_PANEL_LAYOUT.right.activePanel),
      panelOrder: rightOrder,
    },
  }
}

function cloneState(state: SidePanelState): SidePanelState {
  return {
    open: state.open,
    activePanel: state.activePanel,
    panelOrder: [...state.panelOrder],
  }
}

function legacySidePanelLayout(rawState: Record<string, unknown>): SidePanelLayout {
  const layout: SidePanelLayout = {
    left: cloneState(DEFAULT_SIDE_PANEL_LAYOUT.left),
    right: cloneState(DEFAULT_SIDE_PANEL_LAYOUT.right),
  }

  if (typeof rawState.sidebarCollapsed === 'boolean') {
    layout.left.open = !rawState.sidebarCollapsed
  }
  if (typeof rawState.rightPanelOpen === 'boolean') {
    layout.right.open = rawState.rightPanelOpen
  }
  if (typeof rawState.rightPanelMode === 'string' && LEGACY_NAVIGATION_PANEL_TYPES.has(rawState.rightPanelMode as PanelType)) {
    layout.right.activePanel = rawState.rightPanelMode as PanelType
  }

  return layout
}

export function normalizePersistedSidePanelLayout(rawState: unknown): SidePanelLayout {
  const state = isRecord(rawState) ? rawState : null
  if (!state) return normalizeSidePanelLayout(DEFAULT_SIDE_PANEL_LAYOUT)

  const legacyLayout = legacySidePanelLayout(state)
  const persistedLayout = isRecord(state.sidePanels) ? state.sidePanels : null
  if (!persistedLayout) {
    return normalizeSidePanelLayout(legacyLayout)
  }

  return normalizeSidePanelLayout({
    left: {
      ...legacyLayout.left,
      ...(isRecord(persistedLayout.left) ? persistedLayout.left : {}),
    },
    right: {
      ...legacyLayout.right,
      ...(isRecord(persistedLayout.right) ? persistedLayout.right : {}),
    },
  })
}

export function panelLabel(panel: PanelType): string {
  if (panel === 'project') return 'Projects'
  if (panel === 'files') return 'Files'
  if (panel === 'changes') return 'Changes'
  if (panel === 'browser') return 'Browser'
  return 'Git'
}

export function findSideForPanel(layout: SidePanelLayout, panel: PanelType): Side {
  if (layout.left.panelOrder.includes(panel)) return 'left'
  if (layout.right.panelOrder.includes(panel)) return 'right'
  return DEFAULT_PANEL_SIDE[panel]
}

function cloneLayout(layout: SidePanelLayout): SidePanelLayout {
  return {
    left: {
      open: layout.left.open,
      activePanel: layout.left.activePanel,
      panelOrder: [...layout.left.panelOrder],
    },
    right: {
      open: layout.right.open,
      activePanel: layout.right.activePanel,
      panelOrder: [...layout.right.panelOrder],
    },
  }
}

export function setSidePanelActive(layout: SidePanelLayout, side: Side, panel: PanelType): SidePanelLayout {
  if (!layout[side].panelOrder.includes(panel)) return layout
  return normalizeSidePanelLayout({
    ...cloneLayout(layout),
    [side]: {
      ...layout[side],
      activePanel: panel,
    },
  })
}

export function setSidePanelOpen(layout: SidePanelLayout, side: Side, open: boolean): SidePanelLayout {
  return normalizeSidePanelLayout({
    ...cloneLayout(layout),
    [side]: {
      ...layout[side],
      open,
    },
  })
}

export function toggleSidePanel(layout: SidePanelLayout, side: Side): SidePanelLayout {
  return setSidePanelOpen(layout, side, !layout[side].open)
}

export function activatePanel(layout: SidePanelLayout, panel: PanelType): SidePanelLayout {
  const side = findSideForPanel(layout, panel)
  return normalizeSidePanelLayout({
    ...cloneLayout(layout),
    [side]: {
      ...layout[side],
      open: true,
      activePanel: panel,
    },
  })
}

export function movePanelToSide(layout: SidePanelLayout, panel: PanelType, side: Side): SidePanelLayout {
  if (findSideForPanel(layout, panel) === side) return layout

  const otherSide: Side = side === 'left' ? 'right' : 'left'
  const next = cloneLayout(layout)

  next.left.panelOrder = next.left.panelOrder.filter((entry) => entry !== panel)
  next.right.panelOrder = next.right.panelOrder.filter((entry) => entry !== panel)
  next[side].panelOrder.push(panel)
  next[side].activePanel = panel
  if (!next[side].open) next[side].open = true

  if (next[otherSide].activePanel === panel) {
    next[otherSide].activePanel = next[otherSide].panelOrder[0] ?? next[otherSide].activePanel
  }

  return normalizeSidePanelLayout(next)
}

export function setProjectPanelSide(layout: SidePanelLayout, side: Side): SidePanelLayout {
  const next = movePanelToSide(layout, 'project', side)
  const otherSide: Side = side === 'left' ? 'right' : 'left'
  let aligned = next
  for (const panel of NAVIGATION_PANEL_TYPES) {
    aligned = movePanelToSide(aligned, panel, otherSide)
  }
  return normalizeSidePanelLayout(aligned)
}

export function setNavigationPanelSide(layout: SidePanelLayout, side: Side): SidePanelLayout {
  const next = cloneLayout(layout)
  let aligned = next
  for (const panel of NAVIGATION_PANEL_TYPES) {
    aligned = movePanelToSide(aligned, panel, side)
  }
  return movePanelToSide(aligned, 'project', side === 'left' ? 'right' : 'left')
}

export function swapSidebarRoles(layout: SidePanelLayout): SidePanelLayout {
  return normalizeSidePanelLayout({
    left: {
      ...layout.right,
      panelOrder: [...layout.right.panelOrder],
    },
    right: {
      ...layout.left,
      panelOrder: [...layout.left.panelOrder],
    },
  })
}
