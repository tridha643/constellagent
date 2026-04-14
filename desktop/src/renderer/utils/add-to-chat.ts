import type { Tab } from '../store/types'
import { useAppStore } from '../store/app-store'
import {
  collectLeaves,
  firstTerminalLeaf,
  resolveAgentPtyForContextInjection,
  resolvePtyForPlanSourceFilePath,
  resolvePtyForTerminalTab,
} from '../store/split-helpers'
import { AGENT_PLAN_RELATIVE_DIRS } from '../../shared/agent-plan-path'
import { wrapBracketedPaste } from './bracketed-paste'
import { formatEditFilePayload } from './edit-file-formatter'
import { getFocusedMonacoEditor } from './add-to-chat-monaco-bridge'

/** Drag-and-drop MIME for absolute file paths from the file tree */
export const CONSTELLAGENT_PATH_MIME = 'application/x-constellagent-path'

/** Drag-and-drop MIME for terminal tab IDs (tab-to-tab merge) */
export const CONSTELLAGENT_TAB_MIME = 'application/x-constellagent-tab'

/** Drag-and-drop MIME for workspace IDs (sidebar reorder) */
export const CONSTELLAGENT_WORKSPACE_MIME = 'application/x-constellagent-workspace'

/** Drag-and-drop MIME for sidebar action button reorder */
export const CONSTELLAGENT_ACTION_MIME = 'application/x-constellagent-action'

/** Drag-and-drop MIME for project section reorder */
export const CONSTELLAGENT_PROJECT_MIME = 'application/x-constellagent-project'

const PLAN_PATH_SEGMENTS = AGENT_PLAN_RELATIVE_DIRS.map((dir) => `/${dir}/`)
const PI_BOOT_DELAY_MS = 1200

export { wrapBracketedPaste }

function formatSelectionAsContext(filePath: string, languageId: string, selection: string): string {
  const fence = languageId && languageId !== 'plaintext' ? languageId : ''
  const header = `// ${filePath}`
  if (fence) {
    return `\`\`\`${fence}\n${header}\n${selection}\n\`\`\`\n`
  }
  return `\`\`\`\n${header}\n${selection}\n\`\`\`\n`
}

function filePathMatches(a: string, b: string): boolean {
  return a === b
}

function isTerminalTabWithFileLeaf(tab: Tab, filePath: string): tab is Extract<Tab, { type: 'terminal' }> {
  if (tab.type !== 'terminal' || !tab.splitRoot) return false
  return collectLeaves(tab.splitRoot).some((leaf) => leaf.contentType === 'file' && filePathMatches(leaf.filePath, filePath))
}

function findReusablePlanSidecarTab(
  tabs: Tab[],
  activeWorkspaceId: string | null,
  filePath: string,
  preferredTabId?: string,
): Extract<Tab, { type: 'terminal' }> | null {
  if (!activeWorkspaceId) return null

  const candidates = tabs.filter(
    (tab): tab is Extract<Tab, { type: 'terminal' }> =>
      tab.workspaceId === activeWorkspaceId
      && tab.type === 'terminal'
      && tab.splitRoot != null
      && isTerminalTabWithFileLeaf(tab, filePath)
      && !!firstTerminalLeaf(tab.splitRoot),
  )
  if (candidates.length === 0) return null
  if (preferredTabId) {
    const preferred = candidates.find((tab) => tab.id === preferredTabId)
    if (preferred) return preferred
  }
  return candidates[0] ?? null
}

async function ensurePlanEditSidecar(filePath: string): Promise<{
  tab: Extract<Tab, { type: 'terminal' }>
  ptyId: string
  needsPiBootstrap: boolean
} | null> {
  const store = useAppStore.getState()
  const preferredTabId = store.planBuildTerminalByPlanPath[filePath]
  const reusable = findReusablePlanSidecarTab(store.tabs, store.activeWorkspaceId, filePath, preferredTabId)
  if (reusable) {
    const terminalLeaf = reusable.splitRoot ? firstTerminalLeaf(reusable.splitRoot) : null
    store.setPlanBuildTerminalForPlan(filePath, reusable.id)
    store.setActiveTab(reusable.id)
    if (terminalLeaf) store.setFocusedPane(reusable.id, terminalLeaf.id)
    return {
      tab: reusable,
      ptyId: resolvePtyForTerminalTab(reusable),
      needsPiBootstrap: reusable.agentType !== 'pi-constell',
    }
  }

  const activeTab = store.tabs.find((tab) => tab.id === store.activeTabId)
  if (!activeTab) return null

  const canSplitActiveTab =
    (activeTab.type === 'markdownPreview' && filePathMatches(activeTab.filePath, filePath))
    || (activeTab.type === 'file' && filePathMatches(activeTab.filePath, filePath))

  if (!canSplitActiveTab) return null

  await store.splitTerminalPaneForTab(activeTab.id, 'horizontal')
  const updated = useAppStore.getState()
  updated.setPlanBuildTerminalForPlan(filePath, activeTab.id)

  const splitTab = updated.tabs.find(
    (tab): tab is Extract<Tab, { type: 'terminal' }> =>
      tab.id === activeTab.id && tab.type === 'terminal' && isTerminalTabWithFileLeaf(tab, filePath),
  )
  if (!splitTab) return null

  const terminalLeaf = splitTab.splitRoot ? firstTerminalLeaf(splitTab.splitRoot) : null
  updated.setActiveTab(splitTab.id)
  if (terminalLeaf) updated.setFocusedPane(splitTab.id, terminalLeaf.id)

  return {
    tab: splitTab,
    ptyId: resolvePtyForTerminalTab(splitTab),
    needsPiBootstrap: splitTab.agentType !== 'pi-constell',
  }
}

interface PlanEditPayloadOverride {
  text?: string
  startLine?: number
  endLine?: number
  fullText?: string
}

async function buildPlanEditPayload(filePath: string, override?: PlanEditPayloadOverride): Promise<string> {
  const overrideText = override?.text?.trim()
  if (overrideText) {
    return formatEditFilePayload({
      filePath,
      text: overrideText,
      startLine: override.startLine,
      endLine: override.endLine,
    })
  }
  if (override?.fullText) {
    return formatEditFilePayload({ filePath, text: override.fullText })
  }

  const editor = getFocusedMonacoEditor()
  const model = editor?.getModel()
  if (model?.uri.path === filePath) {
    const selection = editor?.getSelection()
    const selectedText = selection && !selection.isEmpty()
      ? model.getValueInRange(selection).trim()
      : ''
    if (selectedText) {
      return formatEditFilePayload({
        filePath,
        text: selectedText,
        startLine: selection?.startLineNumber,
        endLine: selection?.endLineNumber,
      })
    }
    return formatEditFilePayload({ filePath, text: model.getValue() })
  }

  const selectedText = window.getSelection()?.toString().trim() ?? ''
  if (selectedText) {
    return formatEditFilePayload({ filePath, text: selectedText })
  }

  const diskText = await window.api.fs.readFile(filePath)
  return formatEditFilePayload({ filePath, text: diskText ?? '' })
}

export function isPlanSidecarPath(filePath: string): boolean {
  return PLAN_PATH_SEGMENTS.some((segment) => filePath.includes(segment))
}

export function sendAddToChatText(filePath: string, languageId: string, selection: string): boolean {
  const trimmed = selection.trim()
  if (!trimmed) return false
  const s = useAppStore.getState()
  const pty =
    resolvePtyForPlanSourceFilePath(
      filePath,
      s.planBuildTerminalByPlanPath,
      s.tabs,
      s.activeWorkspaceId,
    ) ??
    resolveAgentPtyForContextInjection({
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      activeWorkspaceId: s.activeWorkspaceId,
    })
  if (!pty) {
    s.addToast({
      id: crypto.randomUUID(),
      message: 'No terminal in this workspace. Press ⌘T to open one.',
      type: 'error',
    })
    return false
  }
  const payload = formatSelectionAsContext(filePath, languageId, trimmed)
  window.api.pty.write(pty, wrapBracketedPaste(payload))
  s.addToast({ id: crypto.randomUUID(), message: 'Added selection to terminal', type: 'info' })
  return true
}

export async function openPlanEditSidecar(filePath: string, override?: PlanEditPayloadOverride): Promise<boolean> {
  const s = useAppStore.getState()
  if (!isPlanSidecarPath(filePath)) return false

  const sidecar = await ensurePlanEditSidecar(filePath)
  if (!sidecar) {
    s.addToast({
      id: crypto.randomUUID(),
      message: 'Could not open a PI sidecar for this plan',
      type: 'error',
    })
    return false
  }

  if (sidecar.needsPiBootstrap) {
    window.api.pty.write(sidecar.ptyId, 'pi\n')
    useAppStore.getState().setTerminalAgentType(sidecar.ptyId, 'pi-constell')
    await new Promise((resolve) => window.setTimeout(resolve, PI_BOOT_DELAY_MS))
  }

  const payload = await buildPlanEditPayload(filePath, override)
  window.api.pty.write(sidecar.ptyId, wrapBracketedPaste(payload))
  s.addToast({ id: crypto.randomUUID(), message: 'Opened PI edit sidecar', type: 'info' })
  return true
}

/**
 * Gather the active selection (Monaco editor or window) and send it to the agent terminal.
 * Returns true if a snippet was sent.
 */
export function sendActiveSelectionToAgent(): boolean {
  const editor = getFocusedMonacoEditor()
  const model = editor?.getModel()
  if (editor && model) {
    const selection = editor.getSelection()
    const text = selection && !selection.isEmpty() ? model.getValueInRange(selection) : ''
    if (text) {
      const uri = model.uri.path
      useAppStore.getState().sendContextToAgent([{
        text,
        filePath: uri || undefined,
        startLine: selection!.startLineNumber,
        endLine: selection!.endLineNumber,
      }])
      return true
    }
  }

  const text = window.getSelection()?.toString()
  if (text) {
    const store = useAppStore.getState()
    const activeTab = store.tabs.find((t) => t.id === store.activeTabId)
    const filePath = activeTab && ('filePath' in activeTab) ? (activeTab as { filePath: string }).filePath : undefined
    store.sendContextToAgent([{ text, filePath }])
    return true
  }

  return false
}

export function sendPathToPty(ptyId: string, absolutePath: string): void {
  window.api.pty.write(ptyId, wrapBracketedPaste(absolutePath))
}

/** Whether the current selection's geometry overlaps this container (works when selection is inside shadow DOM). */
export function selectionOverlapsElement(container: HTMLElement, sel: Selection | null): boolean {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false
  const r = sel.getRangeAt(0).getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return false
  const b = container.getBoundingClientRect()
  return r.bottom >= b.top && r.top <= b.bottom && r.right >= b.left && r.left <= b.right
}

/**
 * After selecting in markdown preview, focus often stays on `body`, so keydown `target` is not inside
 * `[data-constellagent-md-preview]`. Resolve the preview root from selection geometry instead.
 */
export function findMarkdownPreviewRootForCurrentSelection(): HTMLElement | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  if (!sel.toString().trim()) return null

  const roots = document.querySelectorAll<HTMLElement>('[data-constellagent-md-preview]')
  for (const root of roots) {
    if (selectionOverlapsElement(root, sel)) {
      return root
    }
  }
  return null
}

