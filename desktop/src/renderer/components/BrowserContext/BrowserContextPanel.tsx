import { useEffect, useMemo, useState } from 'react'
import { MousePointer2, Paintbrush, Plug, Trash2, Upload } from 'lucide-react'
import { useAppStore } from '../../store/app-store'
import { formatComponentMutationContext, formatSelectedComponentContext } from '../../../shared/browser-context-format'
import type { SelectedComponentContext } from '../../../shared/browser-context-types'
import styles from './BrowserContextPanel.module.css'

function activeWorktreePath(): string | null {
  const store = useAppStore.getState()
  const workspace = store.workspaces.find((entry) => entry.id === store.activeWorkspaceId)
  return workspace?.worktreePath ?? null
}

async function withSourceSnippet(component: SelectedComponentContext): Promise<SelectedComponentContext> {
  const worktreePath = activeWorktreePath()
  const sourceFile = component.agentMetadata.file
  if (!worktreePath || !sourceFile) return component
  try {
    const snippet = await window.api.browserContext.readSource({
      worktreePath,
      sourceFile,
      sourceLine: component.agentMetadata.line,
      radius: 20,
    })
    return snippet ? { ...component, sourceSnippet: snippet } : component
  } catch {
    return component
  }
}

export function BrowserContextPanel() {
  const status = useAppStore((s) => s.browserContextStatus)
  const inspectMode = useAppStore((s) => s.browserInspectMode)
  const editMode = useAppStore((s) => s.browserEditMode)
  const selected = useAppStore((s) => s.browserSelectedComponent)
  const latestMutation = useAppStore((s) => s.browserLatestMutation)
  const setStatus = useAppStore((s) => s.setBrowserContextStatus)
  const setInspectMode = useAppStore((s) => s.setBrowserInspectMode)
  const setEditMode = useAppStore((s) => s.setBrowserEditMode)
  const setSelected = useAppStore((s) => s.setBrowserSelectedComponent)
  const setMutation = useAppStore((s) => s.setBrowserLatestMutation)
  const sendContextToAgent = useAppStore((s) => s.sendContextToAgent)
  const addToast = useAppStore((s) => s.addToast)
  const [styleValue, setStyleValue] = useState('#ffcc00')

  useEffect(() => {
    void window.api.browserContext.status().then(setStatus).catch(() => {})
    return window.api.browserContext.onEvent((event) => {
      if (event.type === 'selected') {
        void withSourceSnippet(event.component).then(setSelected)
      } else {
        setMutation(event.mutation)
        const fallbackText = formatComponentMutationContext(event.mutation)
        sendContextToAgent([{
          text: fallbackText,
          contextItem: {
            type: 'ui-component-mutation',
            mutation: event.mutation,
            fallbackText,
          },
        }])
      }
    })
  }, [sendContextToAgent, setMutation, setSelected, setStatus])

  const selectedText = useMemo(
    () => selected ? formatSelectedComponentContext(selected) : '',
    [selected],
  )
  const mutationText = useMemo(
    () => latestMutation ? formatComponentMutationContext(latestMutation) : '',
    [latestMutation],
  )

  async function connect() {
    try {
      setStatus(await window.api.browserContext.connect())
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect browser'
      setStatus({ ...status, connected: false, error: message })
      addToast({ id: crypto.randomUUID(), type: 'error', message })
    }
  }

  async function toggleInspect() {
    const next = !inspectMode
    setInspectMode(next)
    try {
      await window.api.browserContext.setInspect(next)
    } catch (err) {
      setInspectMode(!next)
      addToast({ id: crypto.randomUUID(), type: 'error', message: err instanceof Error ? err.message : 'Inspect toggle failed' })
    }
  }

  async function toggleEdit() {
    const next = !editMode
    setEditMode(next)
    try {
      await window.api.browserContext.setEdit(next)
    } catch (err) {
      setEditMode(!next)
      addToast({ id: crypto.randomUUID(), type: 'error', message: err instanceof Error ? err.message : 'Edit toggle failed' })
    }
  }

  async function clear() {
    setSelected(null)
    setMutation(null)
    await window.api.browserContext.clear().catch(() => {})
  }

  function addSelectedToChat() {
    if (!selected) return
    sendContextToAgent([{
      text: selectedText,
      filePath: selected.sourceSnippet?.filePath,
      contextItem: {
        type: 'selected-ui-component',
        selectedComponent: selected,
        fallbackText: selectedText,
      },
    }])
  }

  async function applyStyle(property: string, value: string) {
    try {
      await window.api.browserContext.applyStyle(property, value)
    } catch (err) {
      addToast({ id: crypto.randomUUID(), type: 'error', message: err instanceof Error ? err.message : 'Style update failed' })
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <button className={styles.button} type="button" onClick={connect}>
          <Plug size={13} /> Open Browser
        </button>
        <button className={[styles.button, inspectMode ? styles.active : ''].join(' ')} type="button" onClick={toggleInspect} disabled={!status.connected}>
          <MousePointer2 size={13} /> Inspect
        </button>
        <button className={[styles.button, editMode ? styles.active : ''].join(' ')} type="button" onClick={toggleEdit} disabled={!status.connected || !selected}>
          <Paintbrush size={13} /> Edit
        </button>
        <button className={styles.button} type="button" onClick={clear} disabled={!selected}>
          <Trash2 size={13} /> Clear
        </button>
        <button className={styles.button} type="button" onClick={addSelectedToChat} disabled={!selected}>
          <Upload size={13} /> Add
        </button>
      </div>
      <div className={styles.body}>
        <div className={styles.status}>
          {status.connected
            ? `Connected to ${status.targetUrl ?? `CDP port ${status.port}`}`
            : status.enabled
              ? 'Open the in-app Chromium browser to inspect the current page.'
              : 'Browser context is disabled by CONSTELLAGENT_CDP_ENABLED=false.'}
          {status.error ? ` ${status.error}` : ''}
        </div>

        {selected ? (
          <>
            <div className={styles.section}>
              <span className={styles.label}>Selected Component</span>
              <div className={styles.code}>{selectedText}</div>
            </div>
            <div className={styles.section}>
              <span className={styles.label}>Style</span>
              <div className={styles.styleGrid}>
                <input className={styles.input} value={styleValue} onChange={(e) => setStyleValue(e.target.value)} />
                <button className={styles.button} type="button" onClick={() => applyStyle('backgroundColor', styleValue)} disabled={!editMode}>Background</button>
                <button className={styles.button} type="button" onClick={() => applyStyle('color', styleValue)} disabled={!editMode}>Text</button>
                <button className={styles.button} type="button" onClick={() => applyStyle('borderColor', styleValue)} disabled={!editMode}>Border</button>
              </div>
            </div>
          </>
        ) : (
          <div className={styles.empty}>Open the in-app Chromium browser, enable Inspect, then click an element in the browser.</div>
        )}

        {latestMutation && (
          <div className={styles.section}>
            <span className={styles.label}>Latest Mutation</span>
            <div className={styles.code}>{mutationText}</div>
          </div>
        )}
      </div>
    </div>
  )
}
