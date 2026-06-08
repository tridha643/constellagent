import { useState, useCallback, useLayoutEffect, useRef, useEffect } from 'react'
import { useAppStore } from '../../store/app-store'
import { useExitAnimation } from '../../hooks/useExitAnimation'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import type {
  Project,
  ProjectIcon,
  PrLinkProvider,
  StartupCommand,
  WaitCondition,
} from '../../store/types'
import styles from './ProjectSettingsDialog.module.css'
import { maybeShowStaleMainToast } from '../../utils/ipc-stale-main'
import {
  PROJECT_ICON_COLORS,
  PROJECT_ICON_GLYPHS,
  DEFAULT_PROJECT_ICON_COLOR,
  DEFAULT_PROJECT_ICON_GLYPH,
} from '../../../shared/project-icon-templates'
import { getProjectIconComponent } from './project-icon-glyphs'

interface CommandWithId extends StartupCommand {
  _id: number
}

interface Props {
  project: Project
  onSave: (settings: {
    startupCommands: StartupCommand[]
    prLinkProvider: PrLinkProvider
    icon: ProjectIcon | null
  }) => void
  onCancel: () => void
}

type IconMode = 'github' | 'template' | 'custom'

/** Match `constellagent-dialog-*--exiting` duration (`--duration-exit`). */
const EXIT_MS = 140

function getRendererApi(): Window['api'] | null {
  return (window as Window & { api?: Window['api'] }).api ?? null
}

function normalizeStartupCommands(list: StartupCommand[] | undefined): StartupCommand[] {
  if (!list?.length) return []
  return list
    .filter((c) => c.command?.trim())
    .map((c) => ({ name: c.name ?? '', command: c.command }))
}

interface StartupCommandRowProps {
  cmd: StartupCommand
  expanded: boolean
  autoFocusCommand: boolean
  isDragging: boolean
  isDropTarget: boolean
  onNameChange: (value: string) => void
  onCommandChange: (value: string) => void
  onRemove: () => void
  onToggleExpand: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}

function StartupCommandRow({
  cmd,
  expanded,
  autoFocusCommand,
  isDragging,
  isDropTarget,
  onNameChange,
  onCommandChange,
  onRemove,
  onToggleExpand,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: StartupCommandRowProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const multilineLocked = cmd.command.includes('\n')
  const expandDisabled = expanded && multilineLocked

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el || !expanded) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 72), 280)}px`
  }, [expanded, cmd.command])

  const blockClass = [
    styles.commandBlock,
    isDragging ? styles.commandBlockDragging : '',
    isDropTarget ? styles.commandBlockDropTarget : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={blockClass}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={styles.commandRowTop}>
        <span className={styles.dragHandle} aria-hidden>⠿</span>
        <input
          className={`${styles.input} ${styles.nameInput}`}
          value={cmd.name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Tab name"
        />
        {!expanded && (
          <input
            className={`${styles.input} ${styles.commandInput}`}
            value={cmd.command}
            onChange={(e) => onCommandChange(e.target.value)}
            placeholder="command"
            autoFocus={autoFocusCommand}
          />
        )}
        <button
          type="button"
          className={styles.expandCmdBtn}
          onClick={onToggleExpand}
          disabled={expandDisabled}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse command field' : 'Expand command field'}
          title={
            expandDisabled
              ? 'Remove line breaks to use single-line mode'
              : expanded
                ? 'Collapse to single line'
                : 'Expand for long or multi-line command'
          }
        >
          <span className={styles.expandCmdIcon} aria-hidden>
            {expanded ? '▴' : '▾'}
          </span>
        </button>
        <button className={styles.removeBtn} onClick={onRemove} title="Remove" type="button">
          ✕
        </button>
      </div>
      {expanded && (
        <textarea
          ref={textareaRef}
          className={styles.commandTextarea}
          value={cmd.command}
          onChange={(e) => onCommandChange(e.target.value)}
          placeholder="command"
          rows={3}
          spellCheck={false}
          autoFocus={autoFocusCommand}
        />
      )}
    </div>
  )
}

export function ProjectSettingsDialog({ project, onSave, onCancel }: Props) {
  const settings = useAppStore((s) => s.settings)
  const addToast = useAppStore((s) => s.addToast)
  const nextIdRef = useRef(0)
  // Play the shared dialog exit before unmounting so close mirrors open as one
  // unit (Emil principle 5) instead of the dialog vanishing instantly.
  const [open, setOpen] = useState(true)
  const { shouldRender, animating } = useExitAnimation(open, EXIT_MS)
  const exiting = animating === 'exit'
  const pendingRef = useRef<(() => void) | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Trap Tab focus inside the dialog so keyboard nav can't reach the obscured app.
  useFocusTrap(dialogRef, shouldRender)

  const beginExit = useCallback((cb: () => void) => {
    if (exiting) return
    pendingRef.current = cb
    setOpen(false)
  }, [exiting])

  useEffect(() => {
    if (!shouldRender && pendingRef.current) {
      const fn = pendingRef.current
      pendingRef.current = null
      fn()
    }
  }, [shouldRender])

  const assignIds = useCallback((list: StartupCommand[]): CommandWithId[] => {
    return list.map((c) => ({ ...c, _id: nextIdRef.current++ }))
  }, [])

  const [commands, setCommands] = useState<CommandWithId[]>(() =>
    assignIds(normalizeStartupCommands(project.startupCommands)),
  )
  const [startupOpen, setStartupOpen] = useState(() => (project.startupCommands?.length ?? 0) > 0)
  const [startupSettingsPath, setStartupSettingsPath] = useState('')
  const [prLinkProvider, setPrLinkProvider] = useState<PrLinkProvider>(
    project.prLinkProvider ?? 'github'
  )

  // --- Icon override state ---
  const [iconMode, setIconMode] = useState<IconMode>(() => project.icon?.type ?? 'github')
  const [templateGlyph, setTemplateGlyph] = useState(
    () => (project.icon?.type === 'template' ? project.icon.glyph : DEFAULT_PROJECT_ICON_GLYPH)
  )
  const [templateColor, setTemplateColor] = useState(
    () => (project.icon?.type === 'template' ? project.icon.color : DEFAULT_PROJECT_ICON_COLOR)
  )
  const [customDataUrl, setCustomDataUrl] = useState<string | null>(null)
  const [customVersion, setCustomVersion] = useState(
    () => (project.icon?.type === 'custom' ? project.icon.version : 0)
  )
  const [hasCustom, setHasCustom] = useState(project.icon?.type === 'custom')

  // Load the stored custom icon preview when the project already has one.
  useEffect(() => {
    if (project.icon?.type !== 'custom') return
    let cancelled = false
    const api = getRendererApi()
    void api?.projectIcon
      ?.get(project.id)
      .then((url) => {
        if (!cancelled) setCustomDataUrl(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [project.id])

  const handlePickCustomIcon = useCallback(async () => {
    const api = getRendererApi()
    if (!api?.projectIcon) return
    try {
      const result = await api.projectIcon.pick(project.id)
      if (result.canceled) return
      if (result.error) {
        addToast({ id: crypto.randomUUID(), message: result.error, type: 'error' })
        return
      }
      if (result.dataUrl) {
        setCustomDataUrl(result.dataUrl)
        setCustomVersion((v) => v + 1)
        setHasCustom(true)
        setIconMode('custom')
      }
    } catch (err) {
      maybeShowStaleMainToast(err, addToast)
    }
  }, [project.id, addToast])

  const handleRemoveCustomIcon = useCallback(async () => {
    const api = getRendererApi()
    try {
      await api?.projectIcon?.clear(project.id)
    } catch {
      // best-effort
    }
    setCustomDataUrl(null)
    setHasCustom(false)
    setIconMode('github')
  }, [project.id])

  const PreviewGlyph = getProjectIconComponent(templateGlyph)
  const enabledSkills = Array.isArray(settings.skills) ? settings.skills.filter((s) => s?.enabled) : []
  const enabledSubagents = Array.isArray(settings.subagents) ? settings.subagents.filter((s) => s?.enabled) : []

  // Expanded rows keyed by stable _id
  const [expandedCommandRows, setExpandedCommandRows] = useState<Set<number>>(() => {
    const s = new Set<number>()
    // commands state is already initialized at this point via useState initializer above,
    // but we need to compute from the raw list since useState initializers run once
    const list = normalizeStartupCommands(project.startupCommands)
    // IDs are 0..n-1 from the assignIds call above
    list.forEach((c, i) => {
      if (c.command.includes('\n')) s.add(i)
    })
    return s
  })

  // Drag state
  const [draggedId, setDraggedId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)

  const handleAdd = useCallback(() => {
    setCommands((prev) => [...prev, { name: '', command: '', _id: nextIdRef.current++ }])
  }, [])

  const handleRemove = useCallback((id: number) => {
    setExpandedCommandRows((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setCommands((prev) => prev.filter((c) => c._id !== id))
  }, [])

  const toggleCommandExpand = useCallback((id: number, commandText: string) => {
    setExpandedCommandRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (commandText.includes('\n')) return prev
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleChange = useCallback((id: number, field: keyof StartupCommand, value: string) => {
    setCommands((prev) =>
      prev.map((cmd) => (cmd._id === id ? { ...cmd, [field]: value } : cmd))
    )
  }, [])

  const handleWaitForChange = useCallback((id: number, waitFor: string) => {
    setCommands((prev) =>
      prev.map((cmd) => {
        if (cmd._id !== id) return cmd
        if (!waitFor) {
          const { waitFor: _wf, waitCondition: _wc, ...rest } = cmd
          return rest as CommandWithId
        }
        return { ...cmd, waitFor, waitCondition: cmd.waitCondition ?? { type: 'delay', seconds: 3 } }
      })
    )
  }, [])

  const handleConditionChange = useCallback((id: number, condition: WaitCondition) => {
    setCommands((prev) =>
      prev.map((cmd) => (cmd._id === id ? { ...cmd, waitCondition: condition } : cmd))
    )
  }, [])

  const handleReorder = useCallback((fromId: number, toId: number) => {
    if (fromId === toId) return
    setCommands((prev) => {
      const fromIdx = prev.findIndex((c) => c._id === fromId)
      const toIdx = prev.findIndex((c) => c._id === toId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }, [])

  const handleDragStart = useCallback((id: number, e: React.DragEvent) => {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(id))
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedId(null)
    setDropTargetId(null)
  }, [])

  const handleDragOver = useCallback((id: number, e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTargetId(id)
  }, [])

  const handleDragLeave = useCallback((id: number) => {
    setDropTargetId((prev) => (prev === id ? null : prev))
  }, [])

  const handleDrop = useCallback((toId: number, e: React.DragEvent) => {
    e.preventDefault()
    const fromId = Number(e.dataTransfer.getData('text/plain'))
    if (!isNaN(fromId)) handleReorder(fromId, toId)
    setDraggedId(null)
    setDropTargetId(null)
  }, [handleReorder])

  const handleCancel = useCallback(() => {
    beginExit(onCancel)
  }, [beginExit, onCancel])

  const handleSave = useCallback(() => {
    // Strip _id before saving
    const stripped: StartupCommand[] = commands.map(({ _id, ...rest }) => rest)
    const normalized = normalizeStartupCommands(stripped)
    const icon: ProjectIcon | null =
      iconMode === 'template'
        ? { type: 'template', glyph: templateGlyph, color: templateColor }
        : iconMode === 'custom' && hasCustom
          ? { type: 'custom', version: customVersion }
          : null
    beginExit(() => onSave({
      startupCommands: normalized.length > 0 ? normalized : [],
      prLinkProvider,
      icon,
    }))
  }, [
    beginExit,
    commands,
    onSave,
    prLinkProvider,
    iconMode,
    templateGlyph,
    templateColor,
    hasCustom,
    customVersion,
  ])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel()
    },
    [handleCancel]
  )

  const configuredStartupCount = commands.filter((c) => c.command.trim()).length

  useEffect(() => {
    let cancelled = false
    const api = getRendererApi()
    if (!api?.projectStartupSettings?.path) {
      setStartupSettingsPath('')
      return () => {
        cancelled = true
      }
    }
    void api.projectStartupSettings.path().then((value) => {
      if (!cancelled) setStartupSettingsPath(value)
    }).catch((err) => {
      maybeShowStaleMainToast(err, addToast)
      if (!cancelled) setStartupSettingsPath('')
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!shouldRender) {
    return null
  }

  return (
    <div
      className={`${styles.overlay} constellagent-dialog-overlay ${exiting ? 'constellagent-dialog-overlay--exiting' : ''}`}
      onClick={handleCancel}
    >
      <div
        ref={dialogRef}
        className={`${styles.dialog} constellagent-dialog-body ${exiting ? 'constellagent-dialog-body--exiting' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.title}>{project.name}</div>

        <button
          type="button"
          className={styles.sectionToggle}
          onClick={() => setStartupOpen((o) => !o)}
          aria-expanded={startupOpen}
        >
          <span className={styles.sectionToggleLabel}>Startup commands</span>
          <span className={styles.sectionToggleMeta}>
            {configuredStartupCount > 0 ? `${configuredStartupCount} configured` : 'optional'}
          </span>
          <span className={`${styles.sectionChevron} ${startupOpen ? styles.sectionChevronOpen : ''}`} aria-hidden>
            ▸
          </span>
        </button>

        {startupOpen && (
          <>
            <div className={styles.hint}>
              Each row opens its own tab. To run steps in order in one tab, use{' '}
              <code className={styles.inlineCode}>&&</code> (for example{' '}
              <code className={styles.inlineCode}>pnpm install && pnpm dev</code>).
            </div>
            <div className={styles.storageHint}>
              Saved outside the repo in{' '}
              <code className={styles.inlineCode}>{startupSettingsPath || '~/Desktop/.constellagent-project-settings.json'}</code>.
            </div>

            <div className={styles.commandList}>
              {commands.map((cmd, i) => (
                <StartupCommandRow
                  key={cmd._id}
                  cmd={cmd}
                  expanded={expandedCommandRows.has(cmd._id)}
                  autoFocusCommand={draggedId === null && i === commands.length - 1}
                  isDragging={draggedId === cmd._id}
                  isDropTarget={dropTargetId === cmd._id && draggedId !== cmd._id}
                  onNameChange={(v) => handleChange(cmd._id, 'name', v)}
                  onCommandChange={(v) => handleChange(cmd._id, 'command', v)}
                  onRemove={() => handleRemove(cmd._id)}
                  onToggleExpand={() => toggleCommandExpand(cmd._id, cmd.command)}
                  onDragStart={(e) => handleDragStart(cmd._id, e)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(cmd._id, e)}
                  onDragLeave={() => handleDragLeave(cmd._id)}
                  onDrop={(e) => handleDrop(cmd._id, e)}
                />
              ))}

              <button className={styles.addBtn} onClick={handleAdd}>
                <span>+</span>
                <span>Add command</span>
              </button>
            </div>
          </>
        )}

        <label className={styles.label}>Icon</label>
        <div className={styles.hint}>
          How this project appears in the sidebar header.
        </div>
        <div className={styles.iconModeRow} role="group" aria-label="Project icon source">
          {(['github', 'template', 'custom'] as IconMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`${styles.iconModeBtn} ${iconMode === m ? styles.iconModeBtnActive : ''}`}
              onClick={() => {
                if (m === 'custom' && !hasCustom) {
                  void handlePickCustomIcon()
                  return
                }
                setIconMode(m)
              }}
            >
              {m === 'github' ? 'GitHub' : m === 'template' ? 'Template' : 'Custom'}
            </button>
          ))}
        </div>

        {iconMode === 'github' && (
          <div className={styles.hint}>
            Uses the GitHub owner avatar, falling back to a generic glyph for non-GitHub remotes.
          </div>
        )}

        {iconMode === 'template' && (
          <div className={styles.iconTemplatePanel}>
            <div className={styles.iconPreview} style={{ color: templateColor }}>
              <PreviewGlyph size={22} strokeWidth={2} />
            </div>
            <div className={styles.glyphGrid}>
              {PROJECT_ICON_GLYPHS.map((g) => {
                const Glyph = getProjectIconComponent(g.id)
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`${styles.glyphBtn} ${templateGlyph === g.id ? styles.glyphBtnActive : ''}`}
                    title={g.label}
                    aria-label={g.label}
                    aria-pressed={templateGlyph === g.id}
                    onClick={() => setTemplateGlyph(g.id)}
                  >
                    <Glyph size={16} strokeWidth={2} />
                  </button>
                )
              })}
            </div>
            <div className={styles.colorRow}>
              {PROJECT_ICON_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`${styles.colorSwatch} ${templateColor === c.var ? styles.colorSwatchActive : ''}`}
                  style={{ background: c.var }}
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={templateColor === c.var}
                  onClick={() => setTemplateColor(c.var)}
                />
              ))}
            </div>
          </div>
        )}

        {iconMode === 'custom' && (
          <div className={styles.iconCustomPanel}>
            <div className={styles.iconPreview}>
              {customDataUrl ? (
                <img src={customDataUrl} alt="" className={styles.iconPreviewImg} />
              ) : (
                <span className={styles.iconPreviewEmpty}>No image</span>
              )}
            </div>
            <div className={styles.uploadRow}>
              <button
                type="button"
                className={styles.uploadBtn}
                onClick={() => void handlePickCustomIcon()}
              >
                {hasCustom ? 'Replace…' : 'Upload…'}
              </button>
              {hasCustom && (
                <button
                  type="button"
                  className={styles.removeIconBtn}
                  onClick={() => void handleRemoveCustomIcon()}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        )}

        <label className={styles.label}>PR Link Provider</label>
        <div className={styles.hint}>
          Where this project opens pull request links.
        </div>
        <select
          className={styles.selectInput}
          value={prLinkProvider}
          onChange={(e) => setPrLinkProvider(e.target.value as PrLinkProvider)}
        >
          <option value="github">GitHub</option>
          <option value="graphite">Graphite</option>
          <option value="devinreview">Devin Review</option>
        </select>

        <label className={styles.label}>Skills & Subagents</label>
        <div className={styles.hint}>
          Enabled skills and subagents from Settings (catalog only). Install into agent dirs locally — see AGENTS.md.
        </div>
        <div className={styles.commandList}>
          {enabledSkills.length === 0 && enabledSubagents.length === 0 ? (
            <div className={styles.hint}>No enabled skills or subagents. Configure them in Settings.</div>
          ) : (
            <>
              {enabledSkills.map((s) => (
                <div key={s.id} className={styles.commandRow}>
                  <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
                    {s.name} <span style={{ color: 'var(--text-ghost)' }}>(skill)</span>
                  </span>
                </div>
              ))}
              {enabledSubagents.map((s) => (
                <div key={s.id} className={styles.commandRow}>
                  <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
                    {s.name} <span style={{ color: 'var(--text-ghost)' }}>(subagent)</span>
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={handleCancel} disabled={exiting}>
            Cancel
          </button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={exiting}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
