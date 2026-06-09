// The "Setup" tab of the right-sidebar bottom dock. Surfaces the project's most
// recently launched (a.k.a. "most used") script as a prominent primary action,
// lists the remaining package.json scripts, and offers a custom command. Each
// launch opens a persistent tmux side terminal running that command — so the
// service keeps running across detach/reattach — and jumps to the Terminal tab.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Play, Plus, TerminalSquare } from 'lucide-react'
import { useAppStore } from '../../store/app-store'
import type { PackageScript, PackageScriptsResult } from '@shared/service-types'
import styles from './SetupPanel.module.css'

interface Props {
  workspace: { id: string; projectId?: string; worktreePath: string } | undefined
}

interface LaunchTarget {
  name: string
  command: string
}

export function SetupPanel({ workspace }: Props) {
  const projects = useAppStore((s) => s.projects)
  const createSideTerminal = useAppStore((s) => s.createSideTerminalForActiveWorkspace)
  const project = workspace ? projects.find((p) => p.id === workspace.projectId) : undefined

  const [scriptsResult, setScriptsResult] = useState<PackageScriptsResult | null>(null)
  const [recent, setRecent] = useState<LaunchTarget[]>([])
  const [customName, setCustomName] = useState('')
  const [customCommand, setCustomCommand] = useState('')

  // Re-read recent on every reveal/launch so the primary action reflects the
  // most recent run without needing a remount.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!workspace) {
      setScriptsResult(null)
      return
    }
    let cancelled = false
    void window.api.packageScripts.list(workspace.worktreePath).then((res) => {
      if (!cancelled) setScriptsResult(res)
    })
    return () => { cancelled = true }
  }, [workspace?.worktreePath])

  useEffect(() => {
    if (!project) {
      setRecent([])
      return
    }
    let cancelled = false
    void window.api.projectStartupSettings.get(project.repoPath).then((res) => {
      if (!cancelled) setRecent(res ?? [])
    })
    return () => { cancelled = true }
  }, [project?.repoPath, reloadKey])

  const scripts = scriptsResult?.scripts ?? []

  // "Most used" = most recently launched (recents are appended, so the last
  // entry is freshest); otherwise the top package.json script (dev/start/…).
  const primary: LaunchTarget | null = useMemo(() => {
    const lastRecent = recent.length > 0 ? recent[recent.length - 1] : null
    if (lastRecent?.command?.trim()) {
      return { name: lastRecent.name || lastRecent.command, command: lastRecent.command }
    }
    const first = scripts[0]
    return first ? { name: first.name, command: first.command } : null
  }, [recent, scripts])

  const rest: PackageScript[] = useMemo(
    () => scripts.filter((s) => !(primary && s.command === primary.command)),
    [scripts, primary],
  )

  const launch = (target: LaunchTarget) => {
    const command = target.command.trim()
    if (!command || !workspace) return
    void createSideTerminal({ title: target.name.trim() || command, initialCommand: command })
    setReloadKey((k) => k + 1)
  }

  const customInputRef = useRef<HTMLInputElement>(null)
  const launchCustom = () => {
    const command = customCommand.trim()
    if (!command) return
    const name = customName.trim() || command.split(/\s+/).slice(0, 2).join(' ')
    launch({ name, command })
    setCustomName('')
    setCustomCommand('')
    customInputRef.current?.focus()
  }

  if (!workspace) {
    return (
      <div className={styles.empty} data-testid="setup-panel">
        <span className={styles.emptyText}>Select a workspace to run its scripts.</span>
      </div>
    )
  }

  const hasScripts = scripts.length > 0

  return (
    <div className={styles.panel} data-testid="setup-panel">
      <div className={styles.scroll}>
        {primary && (
          <button
            type="button"
            className={styles.primary}
            data-testid="setup-primary-run"
            onClick={() => launch(primary)}
          >
            <span className={styles.primaryIcon} aria-hidden="true">
              <Play size={15} strokeWidth={2.25} />
            </span>
            <span className={styles.primaryText}>
              <span className={styles.primaryName}>{primary.name}</span>
              <span className={styles.primaryCommand}>{primary.command}</span>
            </span>
            <span className={styles.primaryHint}>
              <TerminalSquare size={13} strokeWidth={2} />
            </span>
          </button>
        )}

        {rest.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Scripts</div>
            <ul className={styles.list}>
              {rest.map((s, i) => (
                <li key={s.name} style={{ '--row-index': i } as CSSProperties}>
                  <button
                    type="button"
                    className={styles.row}
                    data-testid={`setup-script-${s.name}`}
                    onClick={() => launch({ name: s.name, command: s.command })}
                  >
                    <Play size={12} strokeWidth={2.25} className={styles.rowIcon} />
                    <span className={styles.rowName}>{s.name}</span>
                    <span className={styles.rowCommand}>{s.command}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!hasScripts && scriptsResult?.missing && (
          <div className={styles.note}>No package.json found — run a custom command below.</div>
        )}

        <form
          className={styles.customForm}
          onSubmit={(e) => {
            e.preventDefault()
            launchCustom()
          }}
        >
          <div className={styles.sectionLabel}>Custom command</div>
          <input
            type="text"
            className={styles.input}
            placeholder="Name (optional)"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            data-testid="setup-custom-name"
          />
          <div className={styles.customRow}>
            <input
              ref={customInputRef}
              type="text"
              className={styles.input}
              placeholder="Command, e.g. bun dev"
              value={customCommand}
              onChange={(e) => setCustomCommand(e.target.value)}
              data-testid="setup-custom-input"
            />
            <button
              type="submit"
              className={styles.runButton}
              disabled={!customCommand.trim()}
              data-testid="setup-custom-run"
            >
              <Plus size={13} strokeWidth={2.5} />
              Run
            </button>
          </div>
          <div className={styles.hint}>Opens a tmux terminal in the active worktree.</div>
        </form>
      </div>
    </div>
  )
}
