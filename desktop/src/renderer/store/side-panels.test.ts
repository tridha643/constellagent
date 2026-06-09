import { describe, expect, it } from 'bun:test'
import { DEFAULT_SIDE_PANEL_LAYOUT } from './types'
import {
  activatePanel,
  findSideForPanel,
  isPanelType,
  movePanelToSide,
  normalizePersistedSidePanelLayout,
  normalizeSidePanelLayout,
  setNavigationPanelSide,
  setProjectPanelSide,
  swapSidebarRoles,
} from './side-panels'

describe('normalizeSidePanelLayout', () => {
  it('falls back to the legacy default layout when persisted data is missing', () => {
    expect(normalizeSidePanelLayout(undefined)).toEqual(DEFAULT_SIDE_PANEL_LAYOUT)
  })

  it('dedupes panels across sides, restores missing panels, and repairs invalid active panels', () => {
    const layout = normalizeSidePanelLayout({
      left: {
        open: false,
        activePanel: 'changes',
        panelOrder: ['project', 'files', 'files'],
      },
      right: {
        open: true,
        activePanel: 'changes',
        panelOrder: ['changes'],
      },
    })

    expect(layout.left.open).toBe(false)
    expect(layout.left.panelOrder).toEqual(['project', 'files'])
    expect(layout.left.activePanel).toBe('project')
    expect(layout.right.panelOrder).toEqual(['changes', 'sideChat'])
    expect(layout.right.activePanel).toBe('changes')
  })

  it('migrates legacy persisted visibility and active-panel fields when sidePanels are missing', () => {
    const layout = normalizePersistedSidePanelLayout({
      sidebarCollapsed: true,
      rightPanelOpen: false,
      rightPanelMode: 'changes',
    })

    expect(layout.left).toEqual({
      open: false,
      activePanel: 'project',
      panelOrder: ['project'],
    })
    expect(layout.right).toEqual({
      open: false,
      activePanel: 'changes',
      panelOrder: ['files', 'changes', 'sideChat'],
    })
  })

  it('fills partially persisted sidePanels from the legacy fallback before normalizing', () => {
    // rightPanelMode 'browser' is no longer a valid navigation panel, so the
    // legacy fallback ignores it and the active panel coerces to a real one (D8).
    const layout = normalizePersistedSidePanelLayout({
      rightPanelOpen: false,
      rightPanelMode: 'browser',
      sidePanels: {
        left: {
          panelOrder: ['project', 'files'],
        },
      },
    })

    expect(layout.left).toEqual({
      open: true,
      activePanel: 'project',
      panelOrder: ['project', 'files'],
    })
    expect(layout.right).toEqual({
      open: false,
      activePanel: 'changes',
      panelOrder: ['changes', 'sideChat'],
    })
  })

  it('drops removed graph panel tokens and repairs graph activePanel', () => {
    const layout = normalizeSidePanelLayout({
      right: {
        open: true,
        activePanel: 'graph',
        panelOrder: ['files', 'graph', 'changes'],
      },
    })

    expect(layout.right.panelOrder).toEqual(['files', 'changes', 'sideChat'])
    expect(layout.right.activePanel).toBe('files')
  })

  it('ignores legacy rightPanelMode graph when hydrating persisted state', () => {
    const layout = normalizePersistedSidePanelLayout({
      rightPanelMode: 'graph',
      sidePanels: {
        right: {
          open: true,
          activePanel: 'graph',
          panelOrder: ['files', 'changes', 'graph', 'sideChat'],
        },
      },
    })

    expect(layout.right.panelOrder).toEqual(['files', 'changes', 'sideChat'])
    expect(layout.right.activePanel).toBe('files')
  })

  // D8: upgrading from a build that shipped the 'browser' side panel must
  // silently drop 'browser' from saved orders and coerce an active 'browser'.
  it('strips the removed "browser" panel and coerces an active browser (D8)', () => {
    expect(isPanelType('browser')).toBe(false)

    const layout = normalizeSidePanelLayout({
      left: { open: true, activePanel: 'project', panelOrder: ['project'] },
      right: { open: true, activePanel: 'browser', panelOrder: ['files', 'browser', 'changes', 'sideChat'] },
    })

    expect(layout.right.panelOrder).toEqual(['files', 'changes', 'sideChat'])
    expect(layout.right.activePanel).toBe('files')
  })

  it('coerces a persisted active "browser" through the full hydrate path (D8)', () => {
    const layout = normalizePersistedSidePanelLayout({
      sidePanels: {
        left: { open: true, activePanel: 'project', panelOrder: ['project'] },
        right: { open: true, activePanel: 'browser', panelOrder: ['browser', 'files', 'changes'] },
      },
    })

    expect(layout.right.panelOrder).not.toContain('browser')
    expect(layout.right.activePanel).not.toBe('browser')
    expect(layout.right.panelOrder).toContain(layout.right.activePanel)
  })
})

describe('side panel ownership helpers', () => {
  it('swaps project and navigation groups cleanly', () => {
    const swapped = setProjectPanelSide(DEFAULT_SIDE_PANEL_LAYOUT, 'right')

    expect(swapped.left.panelOrder).toEqual(['files', 'changes'])
    expect(swapped.right.panelOrder).toEqual(['sideChat', 'project'])
    expect(findSideForPanel(swapped, 'project')).toBe('right')
    expect(findSideForPanel(swapped, 'files')).toBe('left')
    expect(findSideForPanel(swapped, 'sideChat')).toBe('right')
  })

  it('lets semantic activation open the owning side after a swap', () => {
    const swapped = setNavigationPanelSide(DEFAULT_SIDE_PANEL_LAYOUT, 'left')
    const closed = {
      ...swapped,
      left: {
        ...swapped.left,
        open: false,
      },
    }

    const activated = activatePanel(closed, 'changes')
    expect(activated.left.open).toBe(true)
    expect(activated.left.activePanel).toBe('changes')
  })

  it('preserves per-side active panels when swapping hosts', () => {
    const custom = normalizeSidePanelLayout({
      left: { open: true, activePanel: 'project', panelOrder: ['project'] },
      right: { open: false, activePanel: 'changes', panelOrder: ['files', 'changes', 'sideChat'] },
    })

    const swapped = swapSidebarRoles(custom)
    expect(swapped.left.panelOrder).toEqual(['files', 'changes', 'sideChat'])
    expect(swapped.left.activePanel).toBe('changes')
    expect(swapped.left.open).toBe(false)
    expect(swapped.right.panelOrder).toEqual(['project'])
    expect(swapped.right.activePanel).toBe('project')
  })

  it('does not reorder a panel when it is already on the requested side', () => {
    const moved = movePanelToSide(DEFAULT_SIDE_PANEL_LAYOUT, 'files', 'right')
    expect(moved).toEqual(DEFAULT_SIDE_PANEL_LAYOUT)
  })
})
