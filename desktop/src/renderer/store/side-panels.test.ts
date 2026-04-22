import { describe, expect, it } from 'bun:test'
import { DEFAULT_SIDE_PANEL_LAYOUT } from './types'
import {
  activatePanel,
  findSideForPanel,
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
    expect(layout.right.panelOrder).toEqual(['changes', 'graph'])
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
      panelOrder: ['files', 'changes', 'graph'],
    })
  })

  it('fills partially persisted sidePanels from the legacy fallback before normalizing', () => {
    const layout = normalizePersistedSidePanelLayout({
      rightPanelOpen: false,
      rightPanelMode: 'graph',
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
      activePanel: 'graph',
      panelOrder: ['changes', 'graph'],
    })
  })
})

describe('side panel ownership helpers', () => {
  it('swaps project and navigation groups cleanly', () => {
    const swapped = setProjectPanelSide(DEFAULT_SIDE_PANEL_LAYOUT, 'right')

    expect(swapped.left.panelOrder).toEqual(['files', 'changes', 'graph'])
    expect(swapped.right.panelOrder).toEqual(['project'])
    expect(findSideForPanel(swapped, 'project')).toBe('right')
    expect(findSideForPanel(swapped, 'files')).toBe('left')
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
      right: { open: false, activePanel: 'graph', panelOrder: ['files', 'changes', 'graph'] },
    })

    const swapped = swapSidebarRoles(custom)
    expect(swapped.left.panelOrder).toEqual(['files', 'changes', 'graph'])
    expect(swapped.left.activePanel).toBe('graph')
    expect(swapped.left.open).toBe(false)
    expect(swapped.right.panelOrder).toEqual(['project'])
    expect(swapped.right.activePanel).toBe('project')
  })

  it('does not reorder a panel when it is already on the requested side', () => {
    const moved = movePanelToSide(DEFAULT_SIDE_PANEL_LAYOUT, 'files', 'right')
    expect(moved).toEqual(DEFAULT_SIDE_PANEL_LAYOUT)
  })
})
