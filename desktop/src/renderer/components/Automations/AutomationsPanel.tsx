import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AutomationAction,
  AutomationAgentType,
  AutomationConfigLike,
  AutomationEventType,
  AutomationTrigger,
} from '../../../shared/automation-types'
import { DEFAULT_AUTOMATION_COOLDOWN_MS } from '../../../shared/automation-types'
import { ChevronLeft } from 'lucide-react'
import { useAppStore } from '../../store/app-store'
import type { Automation } from '../../store/types'
import {
  COMPOSIO_AUTOMATION_AGENT_LABELS,
  COMPOSIO_AUTOMATION_AGENTS,
  COMPOSIO_AUTOMATION_AGENT_GUARDRAILS,
  type ComposioAutomationAgent,
  type ComposioAutomationDefinition,
} from '../../../shared/composio-types'
import { FloatingPanel } from '../FloatingPanel/FloatingPanel'
import { Tooltip } from '../Tooltip/Tooltip'
import styles from './AutomationsPanel.module.css'

const SCHEDULE_PRESETS = [
  { label: 'Every 30 minutes', cron: '*/30 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily at 9am', cron: '0 9 * * *' },
  { label: 'Weekly on Monday', cron: '0 9 * * 1' },
  { label: 'Custom', cron: '' },
]

const EVENT_OPTIONS: Array<{ label: string; value: AutomationEventType }> = [
  { label: 'Agent Started', value: 'agent:started' },
  { label: 'Agent Stopped', value: 'agent:stopped' },
  { label: 'Agent Tool Used', value: 'agent:tool-used' },
  { label: 'PR Created', value: 'pr:created' },
  { label: 'PR Merged', value: 'pr:merged' },
  { label: 'PR Checks Failed', value: 'pr:checks-failed' },
  { label: 'PR Checks Passed', value: 'pr:checks-passed' },
  { label: 'PR Approved', value: 'pr:approved' },
  { label: 'PR Changes Requested', value: 'pr:changes-requested' },
  { label: 'PR Comments Received', value: 'pr:comments-received' },
  { label: 'Workspace Created', value: 'workspace:created' },
  { label: 'Workspace Deleted', value: 'workspace:deleted' },
]

const AGENT_FILTER_OPTIONS = [
  { label: 'Claude', value: 'claude-code' },
  { label: 'Codex', value: 'codex' },
  { label: 'Gemini', value: 'gemini' },
  { label: 'Cursor', value: 'cursor' },
] as const

function formatLastRun(timestamp?: number): string {
  if (!timestamp) return 'Never run'
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function legacyPromptForAction(action: AutomationAction): string {
  return action.type === 'run-prompt' ? action.prompt : ''
}

function legacyCronForTrigger(trigger: AutomationTrigger): string {
  return trigger.type === 'cron' ? trigger.cronExpression : ''
}

function toAutomationIpcConfig(automation: Automation, repoPath: string): AutomationConfigLike {
  return {
    id: automation.id,
    name: automation.name,
    projectId: automation.projectId,
    trigger: automation.trigger ?? { type: 'cron', cronExpression: automation.cronExpression },
    action: automation.action ?? { type: 'run-prompt', prompt: automation.prompt },
    enabled: automation.enabled,
    repoPath,
    cooldownMs: automation.cooldownMs ?? DEFAULT_AUTOMATION_COOLDOWN_MS,
    ...(automation.composio ? { composio: automation.composio } : {}),
  }
}

function describeTrigger(automation: Automation): string {
  const trigger = automation.trigger
  if (!trigger || trigger.type === 'cron') return automation.cronExpression || 'Schedule'
  if (trigger.type === 'manual') return 'Manual'
  return EVENT_OPTIONS.find((option) => option.value === trigger.eventType)?.label ?? trigger.eventType
}

function formatComposioUpdatedAt(value?: string): string {
  if (!value) return 'Not updated yet'
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  return formatLastRun(ms)
}

/** Stable row identity when multiple file automations share a repo (distinct triggers). */
function composioDefinitionRowKey(d: ComposioAutomationDefinition): string {
  return `${d.repoPath}\0${d.id}\0${d.triggerSlug ?? ''}\0${d.triggerId ?? ''}`
}

function ComposioAutomationAgentField({
  definition,
  saveDisabled,
  onUpdated,
}: {
  definition: ComposioAutomationDefinition
  saveDisabled?: boolean
  onUpdated: (d: ComposioAutomationDefinition) => void
}) {
  const addToast = useAppStore((s) => s.addToast)
  const [pending, setPending] = useState(false)

  const onChange = useCallback(async (agent: ComposioAutomationAgent) => {
    if (agent === definition.agent) return
    setPending(true)
    try {
      const updated = await window.api.composio.setAutomationDefinitionAgent({
        repoPath: definition.repoPath,
        id: definition.id,
        agent,
      })
      onUpdated(updated)
      addToast({
        id: crypto.randomUUID(),
        type: 'info',
        message: `Using ${COMPOSIO_AUTOMATION_AGENT_LABELS[agent]} for “${definition.name}”`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save agent'
      addToast({ id: crypto.randomUUID(), type: 'error', message })
    } finally {
      setPending(false)
    }
  }, [addToast, definition.agent, definition.id, definition.name, definition.repoPath, onUpdated])

  return (
    <div className={styles.composioAgentRow}>
      <label className={styles.composioPromptLabel} htmlFor={`composio-agent-${definition.id}`}>
        Agent
      </label>
      <select
        id={`composio-agent-${definition.id}`}
        className={styles.composioAgentSelect}
        value={definition.agent}
        onChange={(event) => void onChange(event.target.value as ComposioAutomationAgent)}
        disabled={saveDisabled || pending}
      >
        {COMPOSIO_AUTOMATION_AGENTS.map((value) => (
          <option key={value} value={value}>
            {COMPOSIO_AUTOMATION_AGENT_LABELS[value]}
          </option>
        ))}
      </select>
    </div>
  )
}

function ComposioAutomationPromptField({
  definition,
  saveDisabled,
  onUpdated,
}: {
  definition: ComposioAutomationDefinition
  saveDisabled?: boolean
  onUpdated: (d: ComposioAutomationDefinition) => void
}) {
  const addToast = useAppStore((s) => s.addToast)
  const [text, setText] = useState(definition.instructions)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setText(definition.instructions)
  }, [definition.instructions, definition.updatedAt, definition.id])

  const flush = useCallback(async () => {
    if (text === definition.instructions) return
    setSaving(true)
    try {
      const updated = await window.api.composio.setAutomationDefinitionInstructions({
        repoPath: definition.repoPath,
        id: definition.id,
        instructions: text,
      })
      onUpdated(updated)
      addToast({
        id: crypto.randomUUID(),
        type: 'info',
        message: `Saved prompt for “${definition.name}”`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save prompt'
      addToast({ id: crypto.randomUUID(), type: 'error', message })
      setText(definition.instructions)
    } finally {
      setSaving(false)
    }
  }, [addToast, definition.id, definition.instructions, definition.name, definition.repoPath, onUpdated, text])

  return (
    <div className={styles.composioPromptBlock}>
      <label className={styles.composioPromptLabel} htmlFor={`composio-prompt-${definition.id}`}>
        Agent prompt
      </label>
      <textarea
        id={`composio-prompt-${definition.id}`}
        className={styles.composioPromptInput}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void flush()}
        rows={4}
        spellCheck={false}
        disabled={saveDisabled || saving}
        placeholder="What should the agent do when this trigger fires? A filtered event summary is added automatically."
      />
      <p className={styles.composioGuardrailHint}>
        <span className={styles.composioGuardrailLead}>Always appended to the agent:</span>
        {COMPOSIO_AUTOMATION_AGENT_GUARDRAILS}
      </p>
    </div>
  )
}

function ComposioAutomationsSection() {
  const addToast = useAppStore((s) => s.addToast)
  const projects = useAppStore((s) => s.projects)
  const repoPaths = useMemo(() => projects.map((project) => project.repoPath).filter(Boolean), [projects])
  const [definitions, setDefinitions] = useState<ComposioAutomationDefinition[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [togglingKey, setTogglingKey] = useState<string | null>(null)

  const projectForRepo = useCallback((repoPath: string) => {
    const normalized = repoPath.replace(/\/+$/, '')
    return projects.find((project) => project.repoPath.replace(/\/+$/, '') === normalized)
  }, [projects])

  const refreshDefinitions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await window.api.composio.listAutomationDefinitions(undefined)
      setDefinitions(next)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Composio automations'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  /** Refresh when projects change so `metadata.repo` resolution can pick up new folders. */
  const projectIds = useMemo(() => projects.map((p) => p.id).sort().join(','), [projects])

  useEffect(() => {
    void refreshDefinitions()
  }, [refreshDefinitions, projectIds])

  const patchDefinition = useCallback((updated: ComposioAutomationDefinition) => {
    setDefinitions((prev) => prev.map((entry) => (
      entry.repoPath === updated.repoPath && entry.id === updated.id ? updated : entry
    )))
  }, [])

  const toggleDefinition = useCallback(async (definition: ComposioAutomationDefinition) => {
    const key = composioDefinitionRowKey(definition)
    const enabled = !definition.enabled
    setTogglingKey(key)
    setDefinitions((prev) => prev.map((entry) => (
      entry.repoPath === definition.repoPath && entry.id === definition.id ? { ...entry, enabled } : entry
    )))
    try {
      const updated = await window.api.composio.setAutomationDefinitionEnabled({
        repoPath: definition.repoPath,
        id: definition.id,
        enabled,
      })
      setDefinitions((prev) => prev.map((entry) => (
        entry.repoPath === definition.repoPath && entry.id === definition.id ? updated : entry
      )))
      addToast({
        id: crypto.randomUUID(),
        message: `${updated.name} ${updated.enabled ? 'enabled' : 'disabled'}`,
        type: 'info',
      })
    } catch (err) {
      setDefinitions((prev) => prev.map((entry) => (
        entry.repoPath === definition.repoPath && entry.id === definition.id ? definition : entry
      )))
      const message = err instanceof Error ? err.message : 'Failed to update Composio automation'
      setError(message)
      addToast({ id: crypto.randomUUID(), message, type: 'error' })
    } finally {
      setTogglingKey(null)
    }
  }, [addToast])

  return (
    <div className={styles.composioSection}>
      <div className={styles.composioHeaderRow}>
        <div>
          <h3 className={styles.composioHeading}>Composio automations</h3>
          <p className={styles.composioHint}>
            File-backed definitions from the Composio × Pi flow (see JSON path below). This block is separate
            from <strong>App automations</strong> underneath (scheduler / GitHub polling). Configure the webhook in
            Settings → Composio.
          </p>
          <p className={styles.composioHint}>
            Edits save back to the file shown on each row:             Pi uses <code>~/.config/pi/composio-automations.json</code>;
            the Composio CLI also uses <code>~/.composio/automations.json</code> (both are loaded; Pi wins if the same
            trigger is listed twice). A <strong>filtered</strong> webhook summary is appended when an automation runs (not the full raw payload).
          </p>
        </div>
        <button type="button" className={styles.smallBtn} onClick={() => void refreshDefinitions()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error ? <p className={styles.composioError}>{error}</p> : null}

      {loading && definitions.length === 0 ? (
        <p className={styles.composioHint}>Loading Composio automations…</p>
      ) : definitions.length === 0 ? (
        <div className={styles.composioEmptyState}>
          <span className={styles.emptyTitle}>No Composio file automations found</span>
          <span className={styles.emptyCopy}>
            {projects.length === 0
              ? 'Open a repository first, then create a Composio automation.'
              : 'Add definitions under ~/.config/pi/composio-automations.json or ~/.composio/automations.json, or create them from the Composio / Pi tools.'}
          </span>
        </div>
      ) : (
        <div className={styles.composioDefinitionList}>
          {definitions.map((definition) => {
            const project = projectForRepo(definition.repoPath)
            const key = composioDefinitionRowKey(definition)
            const triggerLabel = definition.triggerSlug || definition.triggerId || 'Composio trigger'
            return (
              <div
                key={key}
                className={`${styles.composioDefinitionRow} ${!definition.enabled ? styles.composioDefinitionDisabled : ''}`}
              >
                <div className={styles.rowInfo}>
                  <div className={styles.rowName}>{definition.name}</div>
                  <div className={styles.rowMeta}>
                    <span>{project?.name ?? 'Unknown repo'}</span>
                    <span>{triggerLabel}</span>
                    <span>{COMPOSIO_AUTOMATION_AGENT_LABELS[definition.agent]}</span>
                    <span>{formatComposioUpdatedAt(definition.updatedAt)}</span>
                  </div>
                  <ComposioAutomationAgentField
                    definition={definition}
                    saveDisabled={togglingKey === key}
                    onUpdated={patchDefinition}
                  />
                  <ComposioAutomationPromptField
                    definition={definition}
                    saveDisabled={togglingKey === key}
                    onUpdated={patchDefinition}
                  />
                  <code className={styles.composioFilePath}>{definition.filePath}</code>
                </div>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={`${styles.toggle} ${definition.enabled ? styles.toggleOn : ''}`}
                    onClick={() => void toggleDefinition(definition)}
                    disabled={togglingKey === key}
                    aria-label={`${definition.enabled ? 'Disable' : 'Enable'} ${definition.name}`}
                    aria-pressed={definition.enabled}
                  >
                    <span className={styles.toggleKnob} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function automationFieldId(prefix: string, suffix: string): string {
  return `automation-${prefix}-${suffix}`
}

function AutomationList({
  onNew,
  onEdit,
}: {
  onNew: () => void
  onEdit: (automation: Automation) => void
}) {
  const automations = useAppStore((s) => s.automations)
  const projects = useAppStore((s) => s.projects)
  const updateAutomation = useAppStore((s) => s.updateAutomation)
  const removeAutomation = useAppStore((s) => s.removeAutomation)
  const showConfirmDialog = useAppStore((s) => s.showConfirmDialog)
  const dismissConfirmDialog = useAppStore((s) => s.dismissConfirmDialog)
  const workspaces = useAppStore((s) => s.workspaces)
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace)

  const handleToggleEnabled = useCallback(async (automation: Automation) => {
    const project = projects.find((entry) => entry.id === automation.projectId)
    if (!project) return
    const enabled = !automation.enabled
    updateAutomation(automation.id, { enabled })
    if (enabled) {
      await window.api.automations.create(toAutomationIpcConfig({ ...automation, enabled }, project.repoPath))
    } else {
      await window.api.automations.delete(automation.id)
    }
  }, [projects, updateAutomation])

  const handleRunNow = useCallback(async (automation: Automation) => {
    const project = projects.find((entry) => entry.id === automation.projectId)
    if (!project) return
    await window.api.automations.runNow(toAutomationIpcConfig(automation, project.repoPath))
  }, [projects])

  const handleDelete = useCallback((automation: Automation) => {
    showConfirmDialog({
      title: 'Delete Automation',
      message: `Delete automation "${automation.name}"? This will remove it and all its run workspaces.`,
      confirmLabel: 'Delete',
      destructive: true,
      tip: 'Tip: Hold \u21e7 Shift while deleting to skip this dialog',
      onConfirm: () => {
        const runWorkspaces = workspaces.filter((workspace) => workspace.automationId === automation.id)
        for (const workspace of runWorkspaces) void deleteWorkspace(workspace.id)
        void window.api.automations.delete(automation.id)
        removeAutomation(automation.id)
        dismissConfirmDialog()
      },
    })
  }, [deleteWorkspace, dismissConfirmDialog, removeAutomation, showConfirmDialog, workspaces])

  const statusDotClass = (status?: Automation['lastRunStatus']) => {
    if (status === 'success') return styles.statusSuccess
    if (status === 'failed' || status === 'timeout') return styles.statusFailed
    return styles.statusNever
  }

  return (
    <>
      {automations.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>⚡</span>
          <span className={styles.emptyTitle}>No automations yet</span>
          <span className={styles.emptyCopy}>
            Create a recurring prompt, event reaction, or manual workflow for this project.
          </span>
          <button className={styles.emptyBtn} onClick={onNew}>+ Create your first automation</button>
        </div>
      ) : (
        automations.map((automation) => {
          const project = projects.find((entry) => entry.id === automation.projectId)
          return (
            <div key={automation.id} className={`${styles.automationRow} ${!automation.enabled ? styles.disabled : ''}`}>
              <span className={`${styles.statusDot} ${statusDotClass(automation.lastRunStatus)}`} />
              <button type="button" className={styles.rowInfoButton} onClick={() => onEdit(automation)}>
                <div className={styles.rowName}>{automation.name}</div>
                <div className={styles.rowMeta}>
                  <span>{project?.name ?? 'Unknown project'}</span>
                  <span>·</span>
                  <span>{describeTrigger(automation)}</span>
                  <span>·</span>
                  <span>{formatLastRun(automation.lastRunAt)}</span>
                </div>
              </button>
              <div className={styles.rowActions}>
                <Tooltip label="Run now">
                  <button className={styles.runBtn} onClick={() => void handleRunNow(automation)}>Run</button>
                </Tooltip>
                <Tooltip label={automation.enabled ? 'Disable' : 'Enable'}>
                  <button
                    className={`${styles.toggle} ${automation.enabled ? styles.toggleOn : ''}`}
                    onClick={() => void handleToggleEnabled(automation)}
                  >
                    <span className={styles.toggleKnob} />
                  </button>
                </Tooltip>
                <Tooltip label="Delete">
                  <button className={styles.deleteBtn} onClick={() => handleDelete(automation)}>✕</button>
                </Tooltip>
              </div>
            </div>
          )
        })
      )}
    </>
  )
}

function AutomationForm({
  editingAutomation,
  onBack,
}: {
  editingAutomation: Automation | null
  onBack: () => void
}) {
  const projects = useAppStore((s) => s.projects)
  const workspaces = useAppStore((s) => s.workspaces)
  const addAutomation = useAppStore((s) => s.addAutomation)
  const updateAutomation = useAppStore((s) => s.updateAutomation)
  const isEditing = Boolean(editingAutomation)

  const initialTrigger = editingAutomation?.trigger ?? {
    type: 'cron',
    cronExpression: editingAutomation?.cronExpression || SCHEDULE_PRESETS[0].cron,
  }
  const initialAction = editingAutomation?.action ?? {
    type: 'run-prompt',
    prompt: editingAutomation?.prompt || '',
  }

  const [projectId, setProjectId] = useState(editingAutomation?.projectId || projects[0]?.id || '')
  const [name, setName] = useState(editingAutomation?.name || '')
  const [nameManuallySet, setNameManuallySet] = useState(isEditing)
  const [triggerType, setTriggerType] = useState<AutomationTrigger['type']>(initialTrigger.type)
  const [selectedPreset, setSelectedPreset] = useState(() => {
    const cronExpression = initialTrigger.type === 'cron' ? initialTrigger.cronExpression : ''
    const index = SCHEDULE_PRESETS.findIndex((preset) => preset.cron === cronExpression)
    return index >= 0 ? index : SCHEDULE_PRESETS.length - 1
  })
  const [customCron, setCustomCron] = useState(initialTrigger.type === 'cron' ? initialTrigger.cronExpression : '')
  const [eventType, setEventType] = useState<AutomationEventType>(
    initialTrigger.type === 'event' ? initialTrigger.eventType : 'agent:stopped'
  )
  const [agentTypes, setAgentTypes] = useState<AutomationAgentType[]>(
    initialTrigger.type === 'event'
      ? initialTrigger.filters?.filter((filter) => filter.field === 'agentType').map((filter) => filter.value) ?? []
      : []
  )
  const [branchPattern, setBranchPattern] = useState(
    initialTrigger.type === 'event'
      ? initialTrigger.filters?.find((filter) => filter.field === 'branch')?.pattern ?? ''
      : ''
  )
  const [toolName, setToolName] = useState(
    initialTrigger.type === 'event'
      ? initialTrigger.filters?.find((filter) => filter.field === 'toolName')?.value ?? ''
      : ''
  )
  const [workspaceFilterId, setWorkspaceFilterId] = useState(
    initialTrigger.type === 'event'
      ? initialTrigger.filters?.find((filter) => filter.field === 'workspaceId')?.value ?? ''
      : ''
  )
  const [actionType, setActionType] = useState<AutomationAction['type']>(initialAction.type)
  const [prompt, setPrompt] = useState(initialAction.type === 'run-prompt' ? initialAction.prompt : editingAutomation?.prompt || '')
  const [shellCommand, setShellCommand] = useState(initialAction.type === 'run-shell-command' ? initialAction.command : '')
  const [notificationTitle, setNotificationTitle] = useState(initialAction.type === 'send-notification' ? initialAction.title : '')
  const [notificationBody, setNotificationBody] = useState(initialAction.type === 'send-notification' ? initialAction.body : '')
  const [ptyWorkspaceId, setPtyWorkspaceId] = useState(initialAction.type === 'write-to-pty' ? initialAction.workspaceId : '')
  const [ptyInput, setPtyInput] = useState(initialAction.type === 'write-to-pty' ? initialAction.input : '')
  const [cooldownSeconds, setCooldownSeconds] = useState(String(Math.max(1, Math.round((editingAutomation?.cooldownMs ?? DEFAULT_AUTOMATION_COOLDOWN_MS) / 1000))))
  const nameFieldId = automationFieldId(editingAutomation?.id ?? 'new', 'name')
  const projectFieldId = automationFieldId(editingAutomation?.id ?? 'new', 'project')
  const triggerFieldId = automationFieldId(editingAutomation?.id ?? 'new', 'trigger')
  const actionFieldId = automationFieldId(editingAutomation?.id ?? 'new', 'action')
  const cooldownFieldId = automationFieldId(editingAutomation?.id ?? 'new', 'cooldown')

  const cronExpression = selectedPreset === SCHEDULE_PRESETS.length - 1
    ? customCron
    : SCHEDULE_PRESETS[selectedPreset].cron

  const projectWorkspaces = workspaces.filter((workspace) => workspace.projectId === projectId)
  const nameSource = (() => {
    switch (actionType) {
      case 'run-prompt':
        return prompt
      case 'run-shell-command':
        return shellCommand
      case 'send-notification':
        return notificationTitle
      case 'write-to-pty':
        return ptyInput
      default:
        return ''
    }
  })()

  useEffect(() => {
    if (!nameManuallySet && nameSource.trim()) {
      setName(nameSource.trim().slice(0, 40))
    }
  }, [nameManuallySet, nameSource])

  useEffect(() => {
    if (workspaceFilterId && !projectWorkspaces.some((workspace) => workspace.id === workspaceFilterId)) {
      setWorkspaceFilterId('')
    }
    if (ptyWorkspaceId && !projectWorkspaces.some((workspace) => workspace.id === ptyWorkspaceId)) {
      setPtyWorkspaceId('')
    }
  }, [projectWorkspaces, ptyWorkspaceId, workspaceFilterId])

  const buildTrigger = (): AutomationTrigger => {
    if (triggerType === 'manual') return { type: 'manual' }
    if (triggerType === 'event') {
      const filters = [
        ...agentTypes.map((value) => ({ field: 'agentType' as const, value })),
        ...(branchPattern.trim() ? [{ field: 'branch' as const, pattern: branchPattern.trim() }] : []),
        ...(toolName.trim() ? [{ field: 'toolName' as const, value: toolName.trim() }] : []),
        ...(workspaceFilterId ? [{ field: 'workspaceId' as const, value: workspaceFilterId }] : []),
      ]
      return {
        type: 'event',
        eventType,
        filters: filters.length > 0 ? filters : undefined,
      }
    }
    return {
      type: 'cron',
      cronExpression,
    }
  }

  const buildAction = (): AutomationAction => {
    switch (actionType) {
      case 'run-prompt':
        return { type: 'run-prompt', prompt: prompt.trim() }
      case 'run-shell-command':
        return { type: 'run-shell-command', command: shellCommand.trim() }
      case 'send-notification':
        return { type: 'send-notification', title: notificationTitle.trim(), body: notificationBody.trim() }
      case 'write-to-pty':
        return { type: 'write-to-pty', workspaceId: ptyWorkspaceId, input: ptyInput }
      default: {
        const exhaustiveCheck: never = actionType
        throw new Error(`Unsupported action type: ${String(exhaustiveCheck)}`)
      }
    }
  }

  const cooldownMs = Math.max(1, Number(cooldownSeconds || '30')) * 1000
  const triggerValid = triggerType === 'manual' || triggerType === 'event' || Boolean(cronExpression.trim())
  const actionValid = (() => {
    switch (actionType) {
      case 'run-prompt':
        return Boolean(prompt.trim())
      case 'run-shell-command':
        return Boolean(shellCommand.trim())
      case 'send-notification':
        return Boolean(notificationTitle.trim() && notificationBody.trim())
      case 'write-to-pty':
        return Boolean(ptyWorkspaceId && ptyInput.length > 0)
      default:
        return false
    }
  })()
  const isValid = Boolean(projectId && name.trim() && triggerValid && actionValid && Number.isFinite(cooldownMs))

  const handleSubmit = useCallback(async () => {
    if (!isValid) return
    const project = projects.find((entry) => entry.id === projectId)
    if (!project) return

    const trigger = buildTrigger()
    const action = buildAction()
    const automation: Automation = {
      id: editingAutomation?.id ?? crypto.randomUUID(),
      name: name.trim(),
      projectId,
      prompt: legacyPromptForAction(action),
      cronExpression: legacyCronForTrigger(trigger),
      enabled: editingAutomation?.enabled ?? true,
      createdAt: editingAutomation?.createdAt ?? Date.now(),
      trigger,
      action,
      cooldownMs,
      lastRunAt: editingAutomation?.lastRunAt,
      lastRunStatus: editingAutomation?.lastRunStatus,
      composio: editingAutomation?.composio,
    }

    if (editingAutomation) {
      updateAutomation(editingAutomation.id, automation)
      await window.api.automations.update(toAutomationIpcConfig(automation, project.repoPath))
    } else {
      addAutomation(automation)
      await window.api.automations.create(toAutomationIpcConfig(automation, project.repoPath))
    }

    onBack()
  }, [actionType, addAutomation, cooldownMs, editingAutomation, isValid, name, notificationBody, notificationTitle, onBack, projectId, projects, prompt, ptyInput, ptyWorkspaceId, shellCommand, triggerType, updateAutomation])

  return (
    <>
      <button className={styles.backLink} onClick={onBack}>← Back</button>
      <div className={styles.formTitle}>{editingAutomation ? 'Edit Automation' : 'New Automation'}</div>

      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor={nameFieldId}>Name</label>
        <input
          id={nameFieldId}
          className={styles.input}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setNameManuallySet(true)
          }}
          placeholder="Automation name"
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor={projectFieldId}>Project</label>
        <select id={projectFieldId} className={styles.input} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor={triggerFieldId}>Trigger</label>
        <div className={styles.segmentedControl}>
          {[
            { label: 'Schedule', value: 'cron' },
            { label: 'Event', value: 'event' },
            { label: 'Manual', value: 'manual' },
          ].map((option) => (
            <button
              key={option.value}
              className={`${styles.segmentBtn} ${triggerType === option.value ? styles.segmentBtnActive : ''}`}
              onClick={() => setTriggerType(option.value as AutomationTrigger['type'])}
            >
              {option.label}
            </button>
          ))}
        </div>

        {triggerType === 'cron' && (
          <div className={styles.cardBlock}>
            <div className={styles.presetGrid}>
              {SCHEDULE_PRESETS.map((preset, index) => (
                <button
                  key={preset.label}
                  className={`${styles.presetBtn} ${selectedPreset === index ? styles.presetActive : ''}`}
                  onClick={() => setSelectedPreset(index)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <input
              id={triggerFieldId}
              className={styles.input}
              value={selectedPreset === SCHEDULE_PRESETS.length - 1 ? customCron : SCHEDULE_PRESETS[selectedPreset].cron}
              onChange={(event) => {
                setCustomCron(event.target.value)
                setSelectedPreset(SCHEDULE_PRESETS.length - 1)
              }}
              placeholder="*/5 * * * *"
            />
          </div>
        )}

        {triggerType === 'event' && (
          <div className={styles.cardBlock}>
            <select id={triggerFieldId} className={styles.input} value={eventType} onChange={(event) => setEventType(event.target.value as AutomationEventType)}>
              {EVENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <div className={styles.inlineLabel}>Agent Filter</div>
            <div className={styles.chipRow}>
              {AGENT_FILTER_OPTIONS.map((option) => {
                const active = agentTypes.includes(option.value)
                return (
                  <button
                    key={option.value}
                    className={`${styles.chipBtn} ${active ? styles.chipBtnActive : ''}`}
                    onClick={() => setAgentTypes((current) => (
                      current.includes(option.value)
                        ? current.filter((value) => value !== option.value)
                        : [...current, option.value]
                    ))}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <div className={styles.twoColGrid}>
              <div>
                <div className={styles.inlineLabel}>Branch Pattern</div>
                <input className={styles.input} value={branchPattern} onChange={(event) => setBranchPattern(event.target.value)} placeholder="feature/*" />
              </div>
              <div>
                <div className={styles.inlineLabel}>Tool Name</div>
                <input className={styles.input} value={toolName} onChange={(event) => setToolName(event.target.value)} placeholder="Bash" />
              </div>
            </div>
            <div>
              <div className={styles.inlineLabel}>Workspace Filter</div>
              <select className={styles.input} value={workspaceFilterId} onChange={(event) => setWorkspaceFilterId(event.target.value)}>
                <option value="">Any workspace</option>
                {projectWorkspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {triggerType === 'manual' && (
          <div id={triggerFieldId} className={styles.helperText}>Manual automations only run when you click Run.</div>
        )}
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor={actionFieldId}>Action</label>
        <div className={styles.segmentedControl}>
          {[
            { label: 'Run Prompt', value: 'run-prompt' },
            { label: 'Shell Command', value: 'run-shell-command' },
            { label: 'Notification', value: 'send-notification' },
            { label: 'Write to PTY', value: 'write-to-pty' },
          ].map((option) => (
            <button
              key={option.value}
              className={`${styles.segmentBtn} ${actionType === option.value ? styles.segmentBtnActive : ''}`}
              onClick={() => setActionType(option.value as AutomationAction['type'])}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className={styles.cardBlock}>
          {actionType === 'run-prompt' && (
            <textarea
              id={actionFieldId}
              className={styles.textarea}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Review the codebase for security issues..."
              rows={4}
            />
          )}
          {actionType === 'run-shell-command' && (
            <input
              id={actionFieldId}
              className={styles.input}
              value={shellCommand}
              onChange={(event) => setShellCommand(event.target.value)}
              placeholder="bun test"
            />
          )}
          {actionType === 'send-notification' && (
            <>
              <input
                id={actionFieldId}
                className={styles.input}
                value={notificationTitle}
                onChange={(event) => setNotificationTitle(event.target.value)}
                placeholder="Checks failed"
              />
              <textarea
                className={styles.textarea}
                value={notificationBody}
                onChange={(event) => setNotificationBody(event.target.value)}
                placeholder="feature/payment has failing checks."
                rows={3}
              />
            </>
          )}
          {actionType === 'write-to-pty' && (
            <>
              <select id={actionFieldId} className={styles.input} value={ptyWorkspaceId} onChange={(event) => setPtyWorkspaceId(event.target.value)}>
                <option value="">Select workspace</option>
                {projectWorkspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                ))}
              </select>
              <textarea
                className={styles.textarea}
                value={ptyInput}
                onChange={(event) => setPtyInput(event.target.value)}
                placeholder="git status&#10;"
                rows={3}
              />
            </>
          )}
        </div>
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor={cooldownFieldId}>Cooldown</label>
        <div className={styles.cooldownRow}>
          <input
            id={cooldownFieldId}
            className={styles.input}
            value={cooldownSeconds}
            onChange={(event) => setCooldownSeconds(event.target.value.replace(/[^\d]/g, ''))}
            placeholder="30"
          />
          <span className={styles.cooldownSuffix}>seconds</span>
        </div>
      </div>

      <div className={styles.formActions}>
        <button className={styles.cancelBtn} onClick={onBack}>Cancel</button>
        <button className={styles.submitBtn} onClick={() => void handleSubmit()} disabled={!isValid}>
          {editingAutomation ? 'Save' : 'Create'}
        </button>
      </div>
    </>
  )
}

export function AutomationsPanel() {
  const toggleAutomations = useAppStore((s) => s.toggleAutomations)
  const [view, setView] = useState<'list' | 'form'>('list')
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null)

  const handleNew = useCallback(() => {
    setEditingAutomation(null)
    setView('form')
  }, [])

  const handleEdit = useCallback((automation: Automation) => {
    setEditingAutomation(automation)
    setView('form')
  }, [])

  const handleBack = useCallback(() => {
    setEditingAutomation(null)
    setView('list')
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (view === 'form') {
        handleBack()
      } else {
        toggleAutomations()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleBack, toggleAutomations, view])

  return (
    <FloatingPanel variant="fullscreen" testId="automations-panel">
      <FloatingPanel.Titlebar trafficLightPad>
        <Tooltip label="Back">
          <button
            type="button"
            className={styles.backBtn}
            onClick={toggleAutomations}
            aria-label="Close automations"
          >
            <ChevronLeft size={16} strokeWidth={2} aria-hidden />
          </button>
        </Tooltip>
        <h2 className={styles.title}>Automations</h2>
        <div className={styles.titlebarSpacer} />
        {view === 'list' && (
          <button className={styles.newBtn} onClick={handleNew}>+ New</button>
        )}
      </FloatingPanel.Titlebar>
      <FloatingPanel.Body className={styles.content}>
        <div className={styles.inner}>
          <p className={styles.subtitle}>Schedule prompts, event hooks, and repeatable workflows.</p>
          {view === 'list' ? (
            <>
              <ComposioAutomationsSection />
              <div className={styles.appAutomationsIntro} role="region" aria-label="App automations">
                <h3 className={styles.appAutomationsHeading}>App automations</h3>
                <p className={styles.appAutomationsHint}>
                  Cron, <strong>GitHub PR events</strong> (poll-based), manual runs, and workspace hooks. These live in
                  Constellagent state, not in <code>~/.config/pi/composio-automations.json</code>.
                </p>
              </div>
              <AutomationList onNew={handleNew} onEdit={handleEdit} />
            </>
          ) : (
            <AutomationForm editingAutomation={editingAutomation} onBack={handleBack} />
          )}
        </div>
      </FloatingPanel.Body>
    </FloatingPanel>
  )
}
