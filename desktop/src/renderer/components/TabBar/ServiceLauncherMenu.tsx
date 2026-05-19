// Popover for the TabBar ▶ button: reads package.json scripts in the active workspace
// (Recent / Common / Other), plus a free-form Custom command field, then hands the choice
// off to createServiceForActiveWorkspace.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../store/app-store'
import type { PackageScript, PackageScriptsResult } from '@shared/service-types'
import styles from './ServiceLauncherMenu.module.css'

const COMMON_SCRIPT_NAMES = new Set(['dev', 'start', 'serve', 'test', 'test:watch', 'build', 'lint'])

interface Props {
  /** Bounding rect of the launcher button — used to anchor the portalled popover. */
  anchorRect: DOMRect | null
  /** Launcher button element; clicks on it are ignored by the outside-click handler so the same click that opened the menu doesn't immediately close it. */
  anchorEl?: HTMLElement | null
  onClose: () => void
}

export function ServiceLauncherMenu({ anchorRect, anchorEl, onClose }: Props) {
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const workspaces = useAppStore((s) => s.workspaces)
  const projects = useAppStore((s) => s.projects)
  const createService = useAppStore((s) => s.createServiceForActiveWorkspace)
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const project = workspace ? projects.find((p) => p.id === workspace.projectId) : undefined

  const [scriptsResult, setScriptsResult] = useState<PackageScriptsResult | null>(null)
  const [recent, setRecent] = useState<{ name: string; command: string }[]>([])
  const [customCommand, setCustomCommand] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    void window.api.packageScripts.list(workspace.worktreePath).then((res) => {
      if (!cancelled) setScriptsResult(res)
    })
    return () => { cancelled = true }
  }, [workspace?.worktreePath])

  useEffect(() => {
    if (!project) return
    let cancelled = false
    void window.api.projectStartupSettings.get(project.repoPath).then((res) => {
      if (!cancelled) setRecent(res ?? [])
    })
    return () => { cancelled = true }
  }, [project?.repoPath])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (containerRef.current?.contains(target)) return
      if (anchorEl?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', handleClickOutside, true)
    return () => document.removeEventListener('mousedown', handleClickOutside, true)
  }, [onClose, anchorEl])

  const { common, other } = useMemo(() => {
    const scripts = scriptsResult?.scripts ?? []
    const c: PackageScript[] = []
    const o: PackageScript[] = []
    for (const s of scripts) {
      if (COMMON_SCRIPT_NAMES.has(s.name)) c.push(s)
      else o.push(s)
    }
    return { common: c, other: o }
  }, [scriptsResult])

  const launchScript = (name: string, command: string) => {
    void createService({ scriptName: name, command })
    onClose()
  }

  const launchCustom = () => {
    const trimmed = customCommand.trim()
    if (!trimmed) return
    launchScript(trimmed.split(/\s+/).slice(0, 2).join(' '), trimmed)
  }

  // Anchor below the button, right-aligned to it. position:fixed escapes the tab bar's
  // overflow:hidden which otherwise clips the popover and makes it untestable.
  const top = anchorRect ? Math.round(anchorRect.bottom + 4) : 60
  const right = anchorRect ? Math.max(8, Math.round(window.innerWidth - anchorRect.right)) : 8

  return createPortal(
    <div
      ref={containerRef}
      className={styles.menu}
      data-testid="service-launcher-menu"
      style={{ top, right }}
    >
      {recent.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Recent</div>
          {recent.map((r) => (
            <button
              key={`recent-${r.command}`}
              type="button"
              className={styles.item}
              onClick={() => launchScript(r.name || r.command, r.command)}
            >
              <span className={styles.itemName}>{r.name || r.command}</span>
              <span className={styles.itemCommand}>{r.command}</span>
            </button>
          ))}
        </>
      )}
      {common.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Common scripts</div>
          {common.map((s) => (
            <button
              key={`common-${s.name}`}
              type="button"
              className={styles.item}
              onClick={() => launchScript(s.name, s.command)}
              data-testid={`service-script-${s.name}`}
            >
              <span className={styles.itemName}>{s.name}</span>
              <span className={styles.itemCommand}>{s.command}</span>
            </button>
          ))}
        </>
      )}
      {other.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Other scripts</div>
          {other.map((s) => (
            <button
              key={`other-${s.name}`}
              type="button"
              className={styles.item}
              onClick={() => launchScript(s.name, s.command)}
              data-testid={`service-script-${s.name}`}
            >
              <span className={styles.itemName}>{s.name}</span>
              <span className={styles.itemCommand}>{s.command}</span>
            </button>
          ))}
        </>
      )}
      <div className={styles.sectionLabel}>Custom command</div>
      <div className={styles.customRow}>
        <input
          type="text"
          className={styles.customInput}
          placeholder="e.g. bun dev"
          value={customCommand}
          onChange={(e) => setCustomCommand(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') launchCustom() }}
          data-testid="service-custom-input"
        />
        <button
          type="button"
          className={styles.customRun}
          onClick={launchCustom}
          disabled={!customCommand.trim()}
          data-testid="service-custom-run"
        >
          Run
        </button>
      </div>
      {scriptsResult?.missing && recent.length === 0 && common.length === 0 && other.length === 0 ? (
        <div className={styles.emptyHint}>No package.json found. Use a custom command.</div>
      ) : null}
    </div>,
    document.body,
  )
}
