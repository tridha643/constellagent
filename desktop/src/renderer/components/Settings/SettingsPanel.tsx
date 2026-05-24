import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ConductorAuthStatus } from '../../../shared/agent-chat-types'
import { useAppStore } from '../../store/app-store'
import type {
  Settings,
  SettingsSectionId,
  FavoriteEditor,
  McpServer,
  AgentType,
  SkillEntry,
  Side,
  SubagentEntry,
} from '../../store/types'
import {
  normalizeConductorDefaultModelSetting,
  normalizeConductorCodexWebSocketsSetting,
  normalizeConductorDefaultProviderSetting,
  normalizeConductorDefaultThinkingLevelSetting,
  NAVIGATION_PANEL_TYPES,
  normalizeLinearIssueCodingAgent,
  normalizeLinearIssueCodingModel,
  normalizeLinearIssueLaunchTarget,
  normalizeLinearIssueConductorProvider,
  normalizeLinearIssueConductorModel,
  normalizeLinearIssueConductorThinkingLevel,
  normalizeConflictResolverAgent,
  normalizeConflictResolverModel,
  normalizeLinearIssueScope,
  normalizeLinearIssuesPriorityPreset,
  normalizePiCommitMessageModel,
} from '../../store/types'
import type { PlanAgent } from '../../../shared/agent-plan-path'
import { BUILD_HARNESS_OPTIONS, PLAN_MODEL_PRESETS } from '../../../shared/plan-build-command'
import type { PiModelOption } from '../../../shared/plan-build-command'
import { formatPiModelOptionLabel } from '../../../shared/pi-models'
import { conductorModelPresets, defaultConductorModel } from '../../../shared/conductor-model-utils'
import { THINKING_LABELS, THINKING_LEVELS } from '../../../shared/conductor-thinking'
import type { ComposioNgrokStatus, ComposioWebhookSettings } from '../../../shared/composio-types'
import {
  getDefaultWorktreeCredentialRules,
  normalizeWorktreeCredentialPattern,
  type WorktreeCredentialRuleKind,
} from '../../../shared/worktree-credentials'
import { ChevronLeft } from 'lucide-react'
import { Tooltip } from '../Tooltip/Tooltip'
import { FloatingPanel } from '../FloatingPanel/FloatingPanel'
import { APPEARANCE_THEME_OPTIONS, type AppearanceThemeId } from '../../theme/appearance'
import { shouldConfirmAppRestart } from './restart-app'
import { linearFetchViewer } from '../../linear/linear-api'
import {
  fetchConductorAuthStatus,
  openCursorApiKeyDocs,
  signInCodex,
  signInCursor,
  syncConductorAuthKeys,
} from '../../lib/conductor-sign-in'
import styles from './SettingsPanel.module.css'

const SHORTCUTS = [
  { action: 'Find in file (when code editor is focused)', keys: '⌘F' },
  { action: 'Find in changed files (diff tab, or Changes panel focused)', keys: '⌘F' },
  { action: 'Quick open file (when editor not focused)', keys: '⌘F' },
  { action: 'New terminal', keys: '⌘T' },
  { action: 'Close pane / tab', keys: '⌘W' },
  { action: 'Close all tabs', keys: '⇧⌘W' },
  { action: 'Next tab', keys: '⇧⌘]' },
  { action: 'Previous tab', keys: '⇧⌘[' },
  { action: 'Previous tab', keys: '⌘←' },
  { action: 'Next tab', keys: '⌘→' },
  { action: 'Split terminal right', keys: '⌘D' },
  { action: 'Split terminal down', keys: '⇧⌘D' },
  { action: 'Open file in split', keys: '⌘\\' },
  { action: 'Open file in split pane', keys: '⌘+Click' },
  { action: 'Previous visible workspace', keys: '⌘[' },
  { action: 'Next visible workspace', keys: '⌘]' },
  { action: 'Next workspace', keys: '⇧⌘↓' },
  { action: 'Previous workspace', keys: '⇧⌘↑' },
  { action: 'Switch project by sidebar index', keys: '⌘1…9' },
  { action: 'New workspace', keys: '⌘N' },
  { action: 'Toggle left sidebar', keys: '⌘B' },
  { action: 'Toggle right sidebar', keys: '⌥⌘B' },
  { action: 'Files panel', keys: '⇧⌘E' },
  { action: 'Changes panel', keys: '⇧⌘G' },
  { action: 'Git panel', keys: '⌥⌘G' },
  { action: 'Focus terminal', keys: '⌘J' },
  { action: 'Increase font size', keys: '⌘+' },
  { action: 'Decrease font size', keys: '⌘−' },
  { action: 'Reset font size', keys: '⌘0' },
  { action: 'Open in editor', keys: '⇧⌘O' },
  { action: 'Context history', keys: '⇧⌘K' },
  { action: 'Plan picker (search + filter by agent)', keys: '⇧⌘M' },
  { action: 'Settings', keys: '⌘,' },
]

const SETTINGS_SIDEBAR: readonly {
  id: SettingsSectionId
  label: string
  blurb: string
}[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    blurb: 'Themes, font sizes, and editor diagnostics tuning.',
  },
  {
    id: 'sidebar',
    label: 'Sidebar',
    blurb: 'Dock Projects against Files / Changes / Git.',
  },
  {
    id: 'general',
    label: 'General',
    blurb: 'Saving habits, integrations, terminals, utilities.',
  },
  {
    id: 'linear',
    label: 'Linear',
    blurb: 'Issues panel API access plus coding defaults.',
  },
  {
    id: 'conductor',
    label: 'Conductor',
    blurb: 'Sign in for in-app chat and choose the default provider/model.',
  },
  {
    id: 'mcp',
    label: 'MCP Servers',
    blurb: 'Agents, commands, and config files backing MCP.',
  },
  {
    id: 'integrations',
    label: 'Agents',
    blurb: 'Claude + Codex hooks and session resumes.',
  },
  {
    id: 'composio',
    label: 'Composio',
    blurb: 'Webhook receiver and public callback URL.',
  },
  {
    id: 'worktree',
    label: 'Worktrees',
    blurb: 'Credential propagation into new repositories.',
  },
  {
    id: 'skills',
    label: 'Skills',
    blurb: 'Catalog skill directories and subagent files — install locally per AGENTS.md.',
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    blurb: 'Keyboard cheatsheet mirrored from the rest of Constellagent.',
  },
]

function ToggleRow({ label, description, value, onChange }: {
  label: string
  description: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className={styles.row} onClick={() => onChange(!value)}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        <div className={styles.rowDescription}>{description}</div>
      </div>
      <button
        className={`${styles.toggle} ${value ? styles.toggleOn : ''}`}
        onClick={(e) => { e.stopPropagation(); onChange(!value) }}
      >
        <span className={styles.toggleKnob} />
      </button>
    </div>
  )
}

function TextRow({ label, description, value, onChange, placeholder, password }: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  password?: boolean
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        <div className={styles.rowDescription}>{description}</div>
      </div>
      <input
        className={styles.textInput}
        type={password ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={password ? 'off' : undefined}
      />
    </div>
  )
}

function NumberRow({ label, description, value, onChange, min = 8, max = 32 }: {
  label: string
  description: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        <div className={styles.rowDescription}>{description}</div>
      </div>
      <div className={styles.stepper}>
        <button
          className={styles.stepperBtn}
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
        >
          −
        </button>
        <span className={styles.stepperValue}>{value}</span>
        <button
          className={styles.stepperBtn}
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
        >
          +
        </button>
      </div>
    </div>
  )
}

function SelectRow({ label, description, value, onChange, options, disabled }: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        <div className={styles.rowDescription}>{description}</div>
      </div>
      <select
        className={styles.textInput}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function ComposioSettingsSection() {
  const composioWebhook = useAppStore((s) => s.composioWebhook)
  const updateComposioWebhook = useAppStore((s) => s.updateComposioWebhook)
  const addToast = useAppStore((s) => s.addToast)
  const [status, setStatus] = useState<{
    callbackUrl?: string
    listening?: boolean
    port?: number
    lastError?: string
  }>({})
  const [ngrokStatus, setNgrokStatus] = useState<ComposioNgrokStatus>({ running: false })
  const [subscribeBusy, setSubscribeBusy] = useState(false)
  const [ngrokBusy, setNgrokBusy] = useState<'start' | 'stop' | null>(null)

  const refreshStatus = useCallback(() => {
    void Promise.all([
      window.api.composio.getWebhookStatus(),
      window.api.composio.getNgrokStatus(),
    ])
      .then(([webhook, ngrok]) => {
        setStatus(webhook)
        setNgrokStatus(ngrok)
      })
      .catch(() => {})
  }, [])

  const applyWebhookSettings = useCallback(async (settings: ComposioWebhookSettings) => {
    const webhook = await window.api.composio.applyWebhookSettings(settings)
    setStatus(webhook)
    return webhook
  }, [])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void applyWebhookSettings(composioWebhook).catch(() => {})
    }, 500)
    return () => window.clearTimeout(timer)
  }, [applyWebhookSettings, composioWebhook])

  useEffect(() => {
    if (!ngrokStatus.running && !ngrokBusy) return undefined
    const timer = window.setInterval(refreshStatus, 3000)
    return () => window.clearInterval(timer)
  }, [ngrokBusy, ngrokStatus.running, refreshStatus])

  const startNgrok = useCallback(async () => {
    setNgrokBusy('start')
    try {
      const next = await window.api.composio.startNgrok(composioWebhook.port)
      setNgrokStatus(next)
      if (next.publicUrl) {
        const updatedSettings = { ...composioWebhook, enabled: true, publicBaseUrl: next.publicUrl }
        updateComposioWebhook({ enabled: true, publicBaseUrl: next.publicUrl })
        await applyWebhookSettings(updatedSettings)
        addToast({
          id: crypto.randomUUID(),
          message: `ngrok tunnel ready: ${next.publicUrl}`,
          type: 'info',
        })
      } else {
        addToast({
          id: crypto.randomUUID(),
          message: 'ngrok started, but no public HTTPS URL was reported yet.',
          type: 'info',
        })
        refreshStatus()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start ngrok tunnel'
      addToast({ id: crypto.randomUUID(), message, type: 'error' })
      refreshStatus()
    } finally {
      setNgrokBusy(null)
    }
  }, [addToast, applyWebhookSettings, composioWebhook, refreshStatus, updateComposioWebhook])

  const stopNgrok = useCallback(async () => {
    setNgrokBusy('stop')
    try {
      const previousUrl = ngrokStatus.publicUrl
      const next = await window.api.composio.stopNgrok()
      setNgrokStatus(next)
      if (previousUrl && composioWebhook.publicBaseUrl === previousUrl) {
        const updatedSettings = { ...composioWebhook, publicBaseUrl: '' }
        updateComposioWebhook({ publicBaseUrl: '' })
        await applyWebhookSettings(updatedSettings)
      } else {
        refreshStatus()
      }
      addToast({ id: crypto.randomUUID(), message: 'ngrok tunnel stopped.', type: 'info' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop ngrok tunnel'
      addToast({ id: crypto.randomUUID(), message, type: 'error' })
    } finally {
      setNgrokBusy(null)
    }
  }, [addToast, applyWebhookSettings, composioWebhook, ngrokStatus.publicUrl, refreshStatus, updateComposioWebhook])

  const registerComposioWebhook = useCallback(async () => {
    setSubscribeBusy(true)
    try {
      await applyWebhookSettings(composioWebhook)
      const res = await window.api.composio.subscribeWebhook({ publicBaseUrl: composioWebhook.publicBaseUrl })
      const extra = [res.id && `id ${res.id}`, res.secret && 'secret returned']
        .filter(Boolean)
        .join(' · ')
      const registeredMsg = extra ? `Composio webhook registered. ${extra}` : 'Composio webhook registered.'
      const reusedMsg = extra
        ? `This webhook URL is already registered with Composio. ${extra}`
        : 'This webhook URL is already registered with Composio.'
      addToast({
        id: crypto.randomUUID(),
        message: res.reusedExisting ? reusedMsg : registeredMsg,
        type: 'info',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Register webhook failed'
      addToast({ id: crypto.randomUUID(), message, type: 'error' })
    } finally {
      setSubscribeBusy(false)
    }
  }, [addToast, applyWebhookSettings, composioWebhook])

  const ngrokActive = Boolean(ngrokStatus.running || ngrokStatus.publicUrl)
  const ngrokStatusLabel = ngrokBusy === 'start'
    ? 'Starting…'
    : ngrokBusy === 'stop'
      ? 'Stopping…'
      : ngrokActive
        ? 'Tunnel ready'
        : 'Not running'
  const ngrokDescription = ngrokStatus.publicUrl
    ? `Forwarding to local port ${ngrokStatus.localPort ?? composioWebhook.port}.`
    : 'Launches the ngrok CLI and fills Public base URL automatically.'

  return (
    <>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Composio Webhook Receiver</div>
        <p className={styles.sectionHint}>
          Configure the local endpoint that receives Composio trigger deliveries. Authentication is handled by the Pi extension, environment, or Composio CLI login — no API key is stored here.
        </p>

        <ToggleRow
          label="Enable local webhook receiver"
          description="Start the local HTTP receiver for Composio trigger payloads."
          value={composioWebhook.enabled}
          onChange={(v) => updateComposioWebhook({ enabled: v })}
        />

        <NumberRow
          label="Port"
          description="Local TCP port for the receiver."
          value={composioWebhook.port}
          min={1}
          max={65535}
          onChange={(v) => updateComposioWebhook({ port: v })}
        />

        <TextRow
          label="Path"
          description="HTTP path that Composio should POST to."
          value={composioWebhook.path}
          onChange={(value) => {
            const trimmed = value.trim()
            updateComposioWebhook({ path: trimmed.startsWith('/') ? trimmed : `/${trimmed}` })
          }}
          placeholder="/webhooks/composio"
        />

        <TextRow
          label="Shared secret"
          description="Optional secret accepted via x-constellagent-webhook-secret or ?secret=."
          value={composioWebhook.sharedSecret}
          onChange={(v) => updateComposioWebhook({ sharedSecret: v })}
          placeholder="Recommended for public tunnels"
          password
        />

        <ToggleRow
          label="Listen on all interfaces"
          description="Bind to 0.0.0.0 for LAN/tunnel access. Keep a shared secret when exposing this."
          value={composioWebhook.bindAllInterfaces}
          onChange={(v) => updateComposioWebhook({ bindAllInterfaces: v })}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Public Callback</div>
        <p className={styles.sectionHint}>
          Use an HTTPS tunnel URL when Composio needs to reach this machine. The callback URL combines the public base URL with the receiver path.
        </p>

        <TextRow
          label="Public base URL"
          description="Tunnel origin such as https://abc.ngrok-free.app."
          value={composioWebhook.publicBaseUrl}
          onChange={(value) => updateComposioWebhook({ publicBaseUrl: value.trim().replace(/\/+$/, '') })}
          placeholder="https://…"
        />

        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>ngrok tunnel</div>
            <div className={styles.rowDescription}>{ngrokDescription}</div>
          </div>
          <div className={styles.statusStack}>
            <span className={ngrokActive ? styles.statusPillOn : styles.statusPill}>{ngrokStatusLabel}</span>
            {ngrokStatus.publicUrl ? (
              <code className={styles.inlineCode}>{ngrokStatus.publicUrl}</code>
            ) : null}
          </div>
        </div>

        {ngrokStatus.lastError ? (
          <p className={styles.errorHint}>ngrok error: {ngrokStatus.lastError}</p>
        ) : null}

        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={Boolean(ngrokBusy)}
            onClick={() => void startNgrok()}
          >
            {ngrokBusy === 'start' ? 'Starting ngrok…' : 'Start ngrok'}
          </button>
          <button
            type="button"
            className={styles.actionBtnDanger}
            disabled={Boolean(ngrokBusy) || !ngrokActive}
            onClick={() => void stopNgrok()}
          >
            {ngrokBusy === 'stop' ? 'Stopping…' : 'Stop ngrok'}
          </button>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>Callback URL</div>
            <div className={styles.rowDescription}>
              {status.listening ? 'Receiver is listening.' : 'Receiver is not listening yet.'}
            </div>
          </div>
          <code className={styles.callbackUrl}>{status.callbackUrl ?? '…'}</code>
        </div>

        {status.lastError ? (
          <p className={styles.errorHint}>Listen error: {status.lastError}</p>
        ) : null}

        <div className={styles.actionRow}>
          <button type="button" className={styles.actionBtn} onClick={refreshStatus}>Refresh</button>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => status.callbackUrl && void navigator.clipboard.writeText(status.callbackUrl)}
            disabled={!status.callbackUrl}
          >
            Copy URL
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            title="Registers this callback URL with Composio webhook_subscriptions."
            disabled={subscribeBusy || !status.callbackUrl || !composioWebhook.publicBaseUrl.trim()}
            onClick={() => void registerComposioWebhook()}
          >
            {subscribeBusy ? 'Registering…' : 'Register in Composio'}
          </button>
        </div>
      </div>
    </>
  )
}

function SidePanelSettingsSection() {
  const sidePanels = useAppStore((s) => s.sidePanels)
  const setProjectPanelSide = useAppStore((s) => s.setProjectPanelSide)
  const setNavigationPanelSide = useAppStore((s) => s.setNavigationPanelSide)
  const swapSidebarRoles = useAppStore((s) => s.swapSidebarRoles)
  const resetSidePanelLayout = useAppStore((s) => s.resetSidePanelLayout)

  const projectSide: Side = sidePanels.left.panelOrder.includes('project') ? 'left' : 'right'
  const navigationSide: Side = sidePanels.left.panelOrder.includes('files') ? 'left' : 'right'
  const splitNavigationPanels = NAVIGATION_PANEL_TYPES.some((panel) => sidePanels.left.panelOrder.includes(panel))
    && NAVIGATION_PANEL_TYPES.some((panel) => sidePanels.right.panelOrder.includes(panel))
  const sideOptions = [
    { value: 'left', label: 'Left' },
    { value: 'right', label: 'Right' },
  ]

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Sidebar Layout</div>
      <div className={styles.sectionHint}>
        Choose which physical side hosts project navigation versus files, changes, and git history.
      </div>
      {splitNavigationPanels && (
        <div className={styles.inlineHint}>
          Panels are custom-docked across both sides right now. The selectors below will regroup them onto one side.
        </div>
      )}

      <SelectRow
        label="Project navigation side"
        description="Where the Projects sidebar lives. The file-navigation sidebar automatically follows the opposite side."
        value={projectSide}
        onChange={(value) => setProjectPanelSide(value as Side)}
        options={sideOptions}
      />

      <SelectRow
        label="Files / Changes / Git side"
        description="Where semantic panel shortcuts route after swapping sidebars."
        value={navigationSide}
        onChange={(value) => setNavigationPanelSide(value as Side)}
        options={sideOptions}
      />

      <div className={styles.row}>
        <div className={styles.rowText}>
          <div className={styles.rowLabel}>Swap sidebar roles</div>
          <div className={styles.rowDescription}>
            Flip both hosts at once while preserving the active panel on each side.
          </div>
        </div>
        <button type="button" className={styles.actionBtn} onClick={() => swapSidebarRoles()}>
          Swap
        </button>
      </div>

      <div className={styles.row}>
        <div className={styles.rowText}>
          <div className={styles.rowLabel}>Restore default docking</div>
          <div className={styles.rowDescription}>
            Put Projects back on the left and Files / Changes / Git back on the right.
          </div>
        </div>
        <button type="button" className={styles.actionBtn} onClick={() => resetSidePanelLayout()}>
          Reset
        </button>
      </div>
    </div>
  )
}

function ThemePresetPicker({ value, onChange }: {
  value: AppearanceThemeId
  onChange: (value: AppearanceThemeId) => void
}) {
  return (
    <div className={styles.themePresetGrid}>
      {APPEARANCE_THEME_OPTIONS.map((theme) => {
        const active = theme.id === value
        return (
          <button
            key={theme.id}
            type="button"
            className={`${styles.themePresetCard} ${active ? styles.themePresetCardActive : ''}`}
            onClick={() => onChange(theme.id)}
          >
            <div className={styles.themePresetHeader}>
              <div>
                <div className={styles.themePresetName}>{theme.label}</div>
                <div className={styles.themePresetDescription}>{theme.description}</div>
              </div>
              <div className={styles.themePresetBadge}>{active ? 'Selected' : 'Built-in'}</div>
            </div>
            <div className={styles.themePresetPreview}>
              <span className={styles.themeSwatch} style={{ background: theme.preview.surface }} />
              <span className={styles.themeSwatch} style={{ background: theme.preview.accent }} />
              <span className={styles.themeSwatch} style={{ background: theme.preview.ink }} />
            </div>
          </button>
        )
      })}
    </div>
  )
}

function SkillsSubagentsSection() {
  const { settings, addSkill, removeSkill, updateSkill, addSubagent, removeSubagent, updateSubagent, addToast } = useAppStore()
  const activeProject = useAppStore((s) => s.activeProject())

  const handleAddSkill = async () => {
    const dirPath = await window.api.app.selectDirectory()
    if (!dirPath) return
    const info = await window.api.skills.scan(dirPath)
    if (!info) {
      addToast({ id: crypto.randomUUID(), message: 'No SKILL.md found in selected directory', type: 'error' })
      return
    }
    const skill: SkillEntry = {
      id: crypto.randomUUID(),
      name: info.name,
      description: info.description,
      sourcePath: dirPath,
      enabled: true,
    }
    addSkill(skill)
    if (activeProject) {
      await window.api.skills.kvSave(activeProject.repoPath, skill).catch(() => {})
    }
  }

  const handleRemoveSkill = async (skill: SkillEntry) => {
    if (activeProject) {
      await window.api.skills.kvRemove(activeProject.repoPath, skill.name).catch(() => {})
    }
    removeSkill(skill.id)
  }

  const handleToggleSkill = async (skill: SkillEntry) => {
    const newEnabled = !skill.enabled
    updateSkill(skill.id, { enabled: newEnabled })
    if (activeProject) {
      await window.api.skills.kvSave(activeProject.repoPath, { ...skill, enabled: newEnabled }).catch(() => {})
    }
  }

  const handleAddSubagent = async () => {
    const filePath = await window.api.app.selectFile([{ name: 'Markdown', extensions: ['md'] }])
    if (!filePath) return
    const info = await window.api.subagents.scan(filePath)
    if (!info) {
      addToast({ id: crypto.randomUUID(), message: 'Could not parse subagent file (needs YAML frontmatter with name)', type: 'error' })
      return
    }
    const subagent: SubagentEntry = {
      id: crypto.randomUUID(),
      name: info.name,
      description: info.description,
      sourcePath: filePath,
      tools: info.tools,
      enabled: true,
    }
    addSubagent(subagent)
    if (activeProject) {
      await window.api.subagents.kvSave(activeProject.repoPath, subagent).catch(() => {})
    }
  }

  const handleRemoveSubagent = async (subagent: SubagentEntry) => {
    if (activeProject) {
      await window.api.subagents.kvRemove(activeProject.repoPath, subagent.name).catch(() => {})
    }
    removeSubagent(subagent.id)
  }

  const handleToggleSubagent = async (subagent: SubagentEntry) => {
    const newEnabled = !subagent.enabled
    updateSubagent(subagent.id, { enabled: newEnabled })
    if (activeProject) {
      await window.api.subagents.kvSave(activeProject.repoPath, { ...subagent, enabled: newEnabled }).catch(() => {})
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Skills & Subagents</div>

      <div className={styles.subsectionLabel}>Skills</div>
      {settings.skills.length === 0 && (
        <div className={styles.emptyHint}>No skills configured. Add a directory containing a SKILL.md file. Install into agent dirs locally — see AGENTS.md.</div>
      )}
      {settings.skills.map((skill) => (
        <div key={skill.id} className={styles.entryRow}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>{skill.name}</div>
            <div className={styles.rowDescription}>{skill.description}</div>
          </div>
          <button
            className={`${styles.toggle} ${skill.enabled ? styles.toggleOn : ''}`}
            onClick={() => handleToggleSkill(skill)}
          >
            <span className={styles.toggleKnob} />
          </button>
          <button className={styles.removeEntryBtn} onClick={() => handleRemoveSkill(skill)} title="Remove">
            ✕
          </button>
        </div>
      ))}
      <button className={styles.addEntryBtn} onClick={handleAddSkill}>+ Add Skill</button>

      <div className={styles.subsectionLabel} style={{ marginTop: 16 }}>Subagents</div>
      {settings.subagents.length === 0 && (
        <div className={styles.emptyHint}>No subagents configured. Add a .md file with YAML frontmatter.</div>
      )}
      {settings.subagents.map((sa) => (
        <div key={sa.id} className={styles.entryRow}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>{sa.name}</div>
            <div className={styles.rowDescription}>{sa.description}{sa.tools ? ` · Tools: ${sa.tools}` : ''}</div>
          </div>
          <button
            className={`${styles.toggle} ${sa.enabled ? styles.toggleOn : ''}`}
            onClick={() => handleToggleSubagent(sa)}
          >
            <span className={styles.toggleKnob} />
          </button>
          <button className={styles.removeEntryBtn} onClick={() => handleRemoveSubagent(sa)} title="Remove">
            ✕
          </button>
        </div>
      ))}
      <button className={styles.addEntryBtn} onClick={handleAddSubagent}>+ Add Subagent</button>
    </div>
  )
}

function describeCredentialRule(kind: WorktreeCredentialRuleKind): string {
  if (kind === 'directory') return 'Directory rule'
  if (kind === 'file') return 'File rule'
  return 'Glob rule'
}

function WorktreeCredentialsSection() {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const addToast = useAppStore((s) => s.addToast)
  const [newPattern, setNewPattern] = useState('')
  const [newKind, setNewKind] = useState<WorktreeCredentialRuleKind>('file')

  const rules = settings.worktreeCredentialRules
  const builtInRules = rules.filter((rule) => rule.builtIn)
  const customRules = rules.filter((rule) => !rule.builtIn)

  const updateRules = (nextRules: typeof rules) => {
    updateSettings({ worktreeCredentialRules: nextRules })
  }

  const handleToggleRule = (id: string) => {
    updateRules(
      rules.map((rule) => (
        rule.id === id
          ? { ...rule, enabled: !rule.enabled }
          : rule
      )),
    )
  }

  const handleRemoveRule = (id: string) => {
    updateRules(rules.filter((rule) => rule.id !== id))
  }

  const handleAddRule = () => {
    const pattern = normalizeWorktreeCredentialPattern(newPattern)
    if (!pattern) {
      addToast({
        id: crypto.randomUUID(),
        message: 'Credential rule pattern cannot be empty',
        type: 'error',
      })
      return
    }

    const duplicate = rules.some((rule) => (
      rule.kind === newKind
      && normalizeWorktreeCredentialPattern(rule.pattern) === pattern
    ))
    if (duplicate) {
      addToast({
        id: crypto.randomUUID(),
        message: 'That credential rule already exists',
        type: 'error',
      })
      return
    }

    updateRules([
      ...rules,
      {
        id: crypto.randomUUID(),
        label: pattern,
        pattern,
        kind: newKind,
        enabled: true,
      },
    ])
    setNewPattern('')
    setNewKind('file')
  }

  const handleResetBuiltIns = () => {
    updateRules([
      ...getDefaultWorktreeCredentialRules(),
      ...customRules,
    ])
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Worktree Credentials</div>
      <div className={styles.sectionHint}>
        Repo-local credential files and directories copied into new worktrees. `.env*` files refresh from the source repo on create; other rules only fill missing destinations.
      </div>

      <div className={styles.subsectionLabel}>Built-in rules</div>
      {builtInRules.map((rule) => (
        <div key={rule.id} className={styles.entryRow}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>{rule.label}</div>
            <div className={styles.rowDescription}>{describeCredentialRule(rule.kind)}</div>
          </div>
          <button
            className={`${styles.toggle} ${rule.enabled ? styles.toggleOn : ''}`}
            onClick={() => handleToggleRule(rule.id)}
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>
      ))}

      <div className={styles.sectionActions}>
        <button className={styles.actionBtn} onClick={handleResetBuiltIns}>
          Reset built-ins
        </button>
      </div>

      <div className={styles.subsectionLabel} style={{ marginTop: 16 }}>Custom rules</div>
      {customRules.length === 0 && (
        <div className={styles.emptyHint}>
          No custom rules yet. Add exact repo-relative files, directories, or simple globs.
        </div>
      )}
      {customRules.map((rule) => (
        <div key={rule.id} className={styles.entryRow}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>{rule.label}</div>
            <div className={styles.rowDescription}>{describeCredentialRule(rule.kind)}</div>
          </div>
          <button
            className={`${styles.toggle} ${rule.enabled ? styles.toggleOn : ''}`}
            onClick={() => handleToggleRule(rule.id)}
          >
            <span className={styles.toggleKnob} />
          </button>
          <button className={styles.removeEntryBtn} onClick={() => handleRemoveRule(rule.id)} title="Remove">
            ✕
          </button>
        </div>
      ))}

      <div className={styles.ruleForm}>
        <input
          className={`${styles.textInput} ${styles.rulePatternInput}`}
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAddRule()
          }}
          placeholder="apps/web/.env.local"
        />
        <select
          className={styles.selectInput}
          value={newKind}
          onChange={(e) => setNewKind(e.target.value as WorktreeCredentialRuleKind)}
        >
          <option value="file">File</option>
          <option value="directory">Directory</option>
          <option value="glob">Glob</option>
        </select>
        <button className={styles.actionBtn} onClick={handleAddRule}>
          Add rule
        </button>
      </div>
      <div className={styles.formHint}>
        Use exact repo-relative paths for file and directory rules. Globs support `*`, `?`, and `**`.
      </div>
    </div>
  )
}

function ClaudeHooksSection() {
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    window.api.claude.checkHooks().then((result: { installed: boolean }) => {
      setInstalled(result.installed)
    }).catch(() => setInstalled(false))
  }, [])

  const handleInstall = async () => {
    setInstalling(true)
    try {
      await window.api.claude.installHooks()
      setInstalled(true)
    } catch {
      setInstalled(false)
    } finally {
      setInstalling(false)
    }
  }

  const handleUninstall = async () => {
    setInstalling(true)
    try {
      await window.api.claude.uninstallHooks()
      setInstalled(false)
    } catch {
      // keep current state
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>Claude Code hooks</div>
        <div className={styles.rowDescription}>
          Show an unread indicator when Claude Code finishes responding in a workspace
        </div>
      </div>
      {installed === true ? (
        <button
          className={styles.actionBtnDanger}
          onClick={handleUninstall}
          disabled={installing}
        >
          {installing ? 'Removing...' : 'Uninstall'}
        </button>
      ) : (
        <button
          className={styles.actionBtn}
          onClick={handleInstall}
          disabled={installing || installed === null}
        >
          {installing ? 'Installing...' : 'Install'}
        </button>
      )}
    </div>
  )
}

function CodexHooksSection() {
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    window.api.codex.checkNotify().then((result: { installed: boolean }) => {
      setInstalled(result.installed)
    }).catch(() => setInstalled(false))
  }, [])

  const handleInstall = async () => {
    setInstalling(true)
    try {
      await window.api.codex.installNotify()
      setInstalled(true)
    } catch {
      setInstalled(false)
    } finally {
      setInstalling(false)
    }
  }

  const handleUninstall = async () => {
    setInstalling(true)
    try {
      await window.api.codex.uninstallNotify()
      setInstalled(false)
    } catch {
      // keep current state
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>Codex hooks</div>
        <div className={styles.rowDescription}>
          Notify on Codex turn completion
        </div>
      </div>
      {installed === true ? (
        <button
          className={styles.actionBtnDanger}
          onClick={handleUninstall}
          disabled={installing}
        >
          {installing ? 'Removing...' : 'Uninstall'}
        </button>
      ) : (
        <button
          className={styles.actionBtn}
          onClick={handleInstall}
          disabled={installing || installed === null}
        >
          {installing ? 'Installing...' : 'Install'}
        </button>
      )}
    </div>
  )
}

const AGENT_LABELS: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
  'gemini': 'Gemini CLI',
  'cursor': 'Cursor',
  'opencode': 'OpenCode',
  'pi-constell': 'PI Constell',
}

function McpServerCard({ server, onDelete, onOpenConfig }: {
  server: McpServer
  onDelete: (name: string) => void
  onOpenConfig: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  const letter = server.name.charAt(0).toUpperCase()

  return (
    <div className={styles.mcpCard}>
      <div className={styles.mcpCardMain} onClick={() => setExpanded(!expanded)}>
        <div className={styles.mcpAvatar}>{letter}</div>
        <div className={styles.mcpCardText}>
          <div className={styles.rowLabel}>{server.name}</div>
          <div className={styles.mcpCardSub}>
            {server.command} {server.args.length > 0 ? server.args[0] : ''}
          </div>
        </div>
        <div className={styles.mcpCardActions}>
          <button
            className={styles.mcpIconBtn}
            title="Edit in config file"
            onClick={(e) => { e.stopPropagation(); onOpenConfig() }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            className={styles.mcpIconBtn}
            title="Delete server"
            onClick={(e) => { e.stopPropagation(); onDelete(server.name) }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>

      <div
        className={`${styles.mcpCardExpandWrap} ${expanded ? styles.mcpCardExpandWrapOpen : ''}`}
        aria-hidden={!expanded}
      >
        <div className={styles.mcpCardExpanded}>
          <div className={styles.mcpCardDetail}>
            <span className={styles.mcpDetailLabel}>Command</span>
            <span className={styles.mcpDetailValue}>{server.command} {server.args.join(' ')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function PiCommitMessageModelSettingsRow({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [piModels, setPiModels] = useState<PiModelOption[]>([])

  useEffect(() => {
    let cancelled = false
    void window.api.app.listPiModels().then((models) => {
      if (cancelled) return
      setPiModels(models)
    }).catch(() => {
      if (cancelled) return
      setPiModels([])
    })
    return () => { cancelled = true }
  }, [])

  const normalized = normalizePiCommitMessageModel(value)
  const selectValue = normalized === '' ? '__default' : normalized

  const modelSelectOptions = useMemo(() => {
    const ids = new Set(piModels.map((m) => m.id))
    const opts: { value: string; label: string }[] = [
      { value: '__default', label: 'App default (composer-2-fast)' },
      ...piModels.map((m) => ({
        value: m.id,
        label: formatPiModelOptionLabel(m),
      })),
    ]
    if (normalized && !ids.has(normalized)) {
      opts.push({ value: normalized, label: `${normalized} (custom)` })
    }
    return opts
  }, [piModels, normalized])

  return (
    <SelectRow
      label="Commit & PR summary model (Pi)"
      description="Pi model for AI-generated commit messages (Changes panel and branch + PR flow). PRs created with gh --fill use those commits as title/body. Empty = composer-2-fast."
      value={selectValue}
      onChange={(v) => onChange(v === '__default' ? '' : v)}
      options={modelSelectOptions}
    />
  )
}

function ConductorSettingsSection({
  cursorApiKey,
  openaiApiKey,
  onCursorKeyChange,
  onOpenaiKeyChange,
}: {
  cursorApiKey: string
  openaiApiKey: string
  onCursorKeyChange: (v: string) => void
  onOpenaiKeyChange: (v: string) => void
}) {
  const [authStatus, setAuthStatus] = useState<ConductorAuthStatus | null>(null)
  const [cursorLoginStarted, setCursorLoginStarted] = useState(false)
  const [codexLoginStarted, setCodexLoginStarted] = useState(false)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const refreshAuth = useCallback(() => {
    void syncConductorAuthKeys(cursorApiKey, openaiApiKey, settings.conductorCodexWebSockets)
    void fetchConductorAuthStatus(true).then(setAuthStatus)
  }, [cursorApiKey, openaiApiKey, settings.conductorCodexWebSockets])

  useEffect(() => {
    refreshAuth()
  }, [refreshAuth])

  useEffect(() => {
    if (!cursorLoginStarted && !codexLoginStarted) return
    const timer = setInterval(refreshAuth, 2000)
    return () => clearInterval(timer)
  }, [cursorLoginStarted, codexLoginStarted, refreshAuth])

  const defaultProvider = normalizeConductorDefaultProviderSetting(
    settings.conductorDefaultProvider,
  )
  const modelPresets = conductorModelPresets(defaultProvider)
  const normalizedDefaultModel = normalizeConductorDefaultModelSetting(
    settings.conductorDefaultModel,
  )
  const modelSelectOptions = useMemo(() => {
    const presetIds = new Set(modelPresets.map((preset) => preset.cliModel))
    const opts = modelPresets.map((preset) => ({
      value: preset.cliModel,
      label: `${preset.label} (${preset.cliModel})`,
    }))
    if (normalizedDefaultModel && !presetIds.has(normalizedDefaultModel)) {
      opts.push({
        value: normalizedDefaultModel,
        label: `${normalizedDefaultModel} (custom)`,
      })
    }
    return opts
  }, [modelPresets, normalizedDefaultModel])
  const modelSelectValue = normalizedDefaultModel || defaultConductorModel(defaultProvider)

  return (
    <>
      <div className={styles.sectionHint}>
        Conductor runs agents inside Constellagent. <strong>Cursor</strong> uses the Cursor SDK — sign in with{' '}
        <code>cursor-agent login</code> signs in the CLI (terminals and plan build). <strong>Conductor chat</strong> uses the Cursor SDK and needs an API key below (or <code>CURSOR_API_KEY</code>). <strong>Codex</strong> uses the OpenAI Codex CLI — sign in with{' '}
        <code>codex login</code> or an OpenAI API key. Keys are stored locally in app settings (same file as Linear).
      </div>
      <div className={styles.sectionHint}>
        Linear issue launches can reuse these defaults — configure under Settings → Linear → Issue → launch target.
      </div>
      <SelectRow
        label="Default provider"
        description="Used for brand-new Conductor chats before you switch providers inside a thread."
        value={defaultProvider}
        onChange={(v) => {
          const nextProvider = normalizeConductorDefaultProviderSetting(v)
          updateSettings({
            conductorDefaultProvider: nextProvider,
            conductorDefaultModel: defaultConductorModel(nextProvider),
          })
        }}
        options={[
          { value: 'cursor', label: 'Cursor' },
          { value: 'codex', label: 'Codex' },
          { value: 'pi', label: 'Pi' },
        ]}
      />
      <SelectRow
        label="Default model"
        description="Starting model for brand-new Conductor chats. You can still change it per thread from the composer."
        value={modelSelectValue}
        onChange={(v) =>
          updateSettings({
            conductorDefaultModel: normalizeConductorDefaultModelSetting(v),
          })
        }
        options={modelSelectOptions}
      />
      <SelectRow
        label="Default reasoning effort"
        description="Starting effort level for brand-new Conductor chats (Codex uses modelReasoningEffort; Cursor uses model id suffixes)."
        value={settings.conductorDefaultThinkingLevel}
        onChange={(v) =>
          updateSettings({
            conductorDefaultThinkingLevel: normalizeConductorDefaultThinkingLevelSetting(v),
          })
        }
        options={THINKING_LEVELS.map((level) => ({
          value: level,
          label: THINKING_LABELS[level],
        }))}
      />
      <SelectRow
        label="Codex WebSockets"
        description="Use Codex SDK WebSocket transport automatically for eligible Codex models, or force the standard CLI transport."
        value={settings.conductorCodexWebSockets}
        onChange={(v) =>
          updateSettings({
            conductorCodexWebSockets: normalizeConductorCodexWebSocketsSetting(v),
          })
        }
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'off', label: 'Off' },
        ]}
      />

      <div className={styles.row}>
        <div className={styles.rowText}>
          <div className={styles.rowLabel}>Cursor</div>
          <div className={styles.rowDescription}>
            {authStatus?.cursor.ready ? authStatus.cursor.detail : authStatus?.cursor.detail ?? 'Checking…'}
          </div>
        </div>
        <div className={styles.rowActions}>
          <span
            className={authStatus?.cursor.ready ? styles.statusPillOk : styles.statusPillWarn}
            aria-live="polite"
          >
            {authStatus?.cursor.ready ? 'Ready' : 'Not signed in'}
          </span>
          {!authStatus?.cursor.ready && (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => {
                setCursorLoginStarted(true)
                void signInCursor(useAppStore.getState)
              }}
            >
              Sign in
            </button>
          )}
        </div>
      </div>
      <TextRow
        label="Cursor API key"
        description="Required for Conductor chat (Cursor SDK). Also reads CURSOR_API_KEY from your environment. cursor-agent login does not substitute for this key."
        value={cursorApiKey}
        onChange={onCursorKeyChange}
        password
        placeholder="key_…"
      />
      <div className={styles.row}>
        <div className={styles.rowText}>
          <div className={styles.rowLabel}>Cursor API docs</div>
          <div className={styles.rowDescription}>Create a key, paste it above, then Refresh status.</div>
        </div>
        <button type="button" className={styles.actionBtn} onClick={openCursorApiKeyDocs}>
          Open docs
        </button>
      </div>

      <div className={styles.row} style={{ marginTop: 12 }}>
        <div className={styles.rowText}>
          <div className={styles.rowLabel}>Codex</div>
          <div className={styles.rowDescription}>
            {authStatus?.codex.ready ? authStatus.codex.detail : authStatus?.codex.detail ?? 'Checking…'}
          </div>
        </div>
        <div className={styles.rowActions}>
          <span
            className={authStatus?.codex.ready ? styles.statusPillOk : styles.statusPillWarn}
            aria-live="polite"
          >
            {authStatus?.codex.ready ? 'Ready' : 'Not signed in'}
          </span>
          {!authStatus?.codex.ready && (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => {
                setCodexLoginStarted(true)
                void signInCodex(useAppStore.getState)
              }}
            >
              Sign in
            </button>
          )}
        </div>
      </div>
      <TextRow
        label="OpenAI API key (optional)"
        description="Alternative to `codex login`. Used when the model selector shows the Codex badge. Also reads OPENAI_API_KEY from your environment."
        value={openaiApiKey}
        onChange={onOpenaiKeyChange}
        password
        placeholder="sk-…"
      />
      <div className={styles.row}>
        <div className={styles.rowText}>
          <div className={styles.rowLabel}>Refresh status</div>
          <div className={styles.rowDescription}>
            After finishing <code>cursor-agent login</code> or <code>codex login</code> in the terminal, refresh to
            update Ready state.
          </div>
        </div>
        <button type="button" className={styles.actionBtn} onClick={refreshAuth}>
          Refresh
        </button>
      </div>
    </>
  )
}

function LinearSettingsSection({
  apiKey,
  onKeyChange,
}: {
  apiKey: string
  onKeyChange: (v: string) => void
}) {
  const addToast = useAppStore((s) => s.addToast)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [testing, setTesting] = useState(false)

  const issueAgent = normalizeLinearIssueCodingAgent(settings.linearIssueCodingAgent)
  const launchTarget = normalizeLinearIssueLaunchTarget(settings.linearIssueLaunchTarget)
  const conductorLaunchProvider = normalizeLinearIssueConductorProvider(
    settings.linearIssueConductorProvider,
  )
  const conductorLaunchModelPresets = conductorModelPresets(conductorLaunchProvider)
  const normalizedConductorLaunchModel = normalizeLinearIssueConductorModel(
    settings.linearIssueConductorModel,
  )
  const conductorLaunchModelOptions = useMemo(() => {
    const presetIds = new Set(conductorLaunchModelPresets.map((preset) => preset.cliModel))
    const opts = conductorLaunchModelPresets.map((preset) => ({
      value: preset.cliModel,
      label: `${preset.label} (${preset.cliModel})`,
    }))
    if (normalizedConductorLaunchModel && !presetIds.has(normalizedConductorLaunchModel)) {
      opts.push({
        value: normalizedConductorLaunchModel,
        label: `${normalizedConductorLaunchModel} (custom)`,
      })
    }
    return opts
  }, [conductorLaunchModelPresets, normalizedConductorLaunchModel])
  const conductorLaunchModelSelectValue =
    normalizedConductorLaunchModel || defaultConductorModel(conductorLaunchProvider)
  const modelPresets = PLAN_MODEL_PRESETS[issueAgent as PlanAgent]
  const modelSelectOptions = useMemo(() => {
    const modelVal = normalizeLinearIssueCodingModel(settings.linearIssueCodingModel).trim()
    const presetIds = new Set(modelPresets.map((p) => p.cliModel))
    const opts: { value: string; label: string }[] = [
      { value: '__default', label: 'CLI default (no --model)' },
      ...modelPresets.map((p) => ({
        value: p.cliModel,
        label: `${p.label} (${p.cliModel})`,
      })),
    ]
    if (modelVal && !presetIds.has(modelVal)) {
      opts.push({ value: modelVal, label: `${modelVal} (custom)` })
    }
    return opts
  }, [modelPresets, settings.linearIssueCodingModel])
  const modelSelectValue =
    normalizeLinearIssueCodingModel(settings.linearIssueCodingModel).trim() === ''
      ? '__default'
      : normalizeLinearIssueCodingModel(settings.linearIssueCodingModel).trim()

  const testConnection = async () => {
    setTesting(true)
    try {
      const r = await linearFetchViewer(apiKey)
      if (r.errors?.length) {
        addToast({
          id: crypto.randomUUID(),
          type: 'error',
          message: r.errors.map((e) => e.message).join('; '),
        })
      } else {
        addToast({
          id: crypto.randomUUID(),
          type: 'info',
          message: `Connected as ${r.data?.viewer?.name ?? 'Linear user'}`,
        })
      }
    } catch (err) {
      addToast({
        id: crypto.randomUUID(),
        type: 'error',
        message: err instanceof Error ? err.message : 'Connection test failed',
      })
    } finally {
      setTesting(false)
    }
  }

  const openLinearSecurity = () => {
    void window.api.app.openExternal('https://linear.app/settings/account/security')
  }

  return (
    <>
      <div className={styles.sectionHint}>
        Create a key under Linear → Settings → Account → Security. Stored locally in app settings (not the OS keychain).
      </div>
      <TextRow
        label="Personal API Key"
          description="Used by the Linear workspace panel. Never logged; sent to Linear only via the app main process."
        value={apiKey}
        onChange={onKeyChange}
        password
        placeholder="lin_api_…"
      />
      <div className={styles.row}>
        <div className={styles.rowText}>
          <div className={styles.rowLabel}>Manage keys in Linear</div>
          <div className={styles.rowDescription}>Open Linear&apos;s security page to create or revoke keys.</div>
        </div>
        <button type="button" className={styles.actionBtn} onClick={openLinearSecurity}>
          Open…
        </button>
      </div>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <div className={styles.rowLabel}>Test connection</div>
          <div className={styles.rowDescription}>Runs a minimal viewer query against the Linear API.</div>
        </div>
        <button
          type="button"
          className={styles.actionBtn}
          disabled={testing || !apiKey.trim()}
          onClick={() => void testConnection()}
        >
          {testing ? 'Testing…' : 'Test'}
        </button>
      </div>
      <SelectRow
        label="Default issue list"
        description="Starting scope for issues in the Linear panel (Issues view). You can change it in the panel anytime."
        value={settings.linearIssueScope}
        onChange={(v) =>
          updateSettings({ linearIssueScope: normalizeLinearIssueScope(v) })
        }
        options={[
          { value: 'assigned', label: 'Assigned to me' },
          { value: 'created', label: 'Created by me' },
        ]}
      />
      <SelectRow
        label="Default priority filter"
        description="Filters the Issues list client-side on loaded issues (not a server query)."
        value={settings.linearIssuesPriorityPreset}
        onChange={(v) =>
          updateSettings({
            linearIssuesPriorityPreset: normalizeLinearIssuesPriorityPreset(v),
          })
        }
        options={[
          { value: 'all', label: 'All priorities' },
          { value: '1', label: 'Urgent' },
          { value: '2', label: 'High' },
          { value: '3', label: 'Medium' },
          { value: '4', label: 'Low' },
        ]}
      />
      <ToggleRow
        label="Copy created issue link"
        description="After creating a ticket from the Tickets tab, copy the new Linear issue URL to your clipboard and mention it in the success toast."
        value={settings.linearCopyCreatedIssueToClipboard}
        onChange={(v) =>
          updateSettings({ linearCopyCreatedIssueToClipboard: v })
        }
      />
      <SelectRow
        label="Issue → launch target"
        description="What opens after creating a worktree from a Linear issue (Issues rocket or Tickets “Open agent”)."
        value={launchTarget}
        onChange={(v) =>
          updateSettings({ linearIssueLaunchTarget: normalizeLinearIssueLaunchTarget(v) })
        }
        options={[
          { value: 'terminal', label: 'Terminal CLI' },
          { value: 'conductor', label: 'Conductor chat' },
        ]}
      />
      {launchTarget === 'conductor' ? (
        <>
          <ToggleRow
            label="Use Conductor defaults"
            description="When on, provider/model/effort come from Settings → Conductor. When off, use the overrides below."
            value={settings.linearIssueConductorUseDefaults}
            onChange={(v) => updateSettings({ linearIssueConductorUseDefaults: v })}
          />
          <SelectRow
            label="Issue → Conductor provider"
            description="Provider for Linear Conductor launches when not using Conductor defaults."
            value={conductorLaunchProvider}
            onChange={(v) => {
              const nextProvider = normalizeLinearIssueConductorProvider(v)
              updateSettings({
                linearIssueConductorProvider: nextProvider,
                linearIssueConductorModel: defaultConductorModel(nextProvider),
              })
            }}
            options={[
              { value: 'cursor', label: 'Cursor' },
              { value: 'codex', label: 'Codex' },
              { value: 'pi', label: 'Pi' },
            ]}
            disabled={settings.linearIssueConductorUseDefaults}
          />
          <SelectRow
            label="Issue → Conductor model"
            description="Starting model for Linear Conductor launches when not using Conductor defaults."
            value={conductorLaunchModelSelectValue}
            onChange={(v) =>
              updateSettings({
                linearIssueConductorModel: normalizeLinearIssueConductorModel(v),
              })
            }
            options={conductorLaunchModelOptions}
            disabled={settings.linearIssueConductorUseDefaults}
          />
          <SelectRow
            label="Issue → Conductor reasoning effort"
            description="Starting effort for Linear Conductor launches when not using Conductor defaults."
            value={settings.linearIssueConductorThinkingLevel}
            onChange={(v) =>
              updateSettings({
                linearIssueConductorThinkingLevel: normalizeLinearIssueConductorThinkingLevel(v),
              })
            }
            options={THINKING_LEVELS.map((level) => ({
              value: level,
              label: THINKING_LABELS[level],
            }))}
            disabled={settings.linearIssueConductorUseDefaults}
          />
          <ToggleRow
            label="Start in plan mode"
            description="Open Linear Conductor sessions with plan mode enabled (good fit for the read-only kickoff prompt)."
            value={settings.linearIssueConductorPlan}
            onChange={(v) => updateSettings({ linearIssueConductorPlan: v })}
          />
          <ToggleRow
            label="Start in canvas mode"
            description="Open Linear Conductor sessions with canvas mode enabled."
            value={settings.linearIssueConductorCanvas}
            onChange={(v) => updateSettings({ linearIssueConductorCanvas: v })}
          />
        </>
      ) : (
        <>
          <SelectRow
            label="Issue → coding agent"
            description="CLI used when you open a Linear issue in a new worktree (Issues table icon or “Open agent” on the ticket-created toast). Uses the currently open workspace’s project as the git repo."
            value={issueAgent}
            onChange={(v) =>
              updateSettings({ linearIssueCodingAgent: normalizeLinearIssueCodingAgent(v) })
            }
            options={BUILD_HARNESS_OPTIONS.map((o) => ({
              value: o.agent,
              label: o.label,
            }))}
          />
          <SelectRow
            label="Issue → agent model"
            description="Passed to the agent as --model when not “CLI default”. Same ids as plan builds."
            value={modelSelectValue}
            onChange={(v) =>
              updateSettings({
                linearIssueCodingModel:
                  v === '__default' ? '' : normalizeLinearIssueCodingModel(v),
              })
            }
            options={modelSelectOptions}
          />
        </>
      )}
      <ToggleRow
        label="Close Linear panel on launch"
        description="After launching from an issue, close the Linear overlay and focus the new workspace."
        value={settings.linearIssueClosePanelOnLaunch}
        onChange={(v) => updateSettings({ linearIssueClosePanelOnLaunch: v })}
      />
      <ConflictResolverAgentRows />
    </>
  )
}

function ConflictResolverAgentRows() {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const agent = normalizeConflictResolverAgent(settings.conflictResolverAgent)
  const modelPresets = PLAN_MODEL_PRESETS[agent as PlanAgent]
  const modelValRaw = normalizeConflictResolverModel(settings.conflictResolverModel).trim()
  const modelSelectOptions = useMemo(() => {
    const presetIds = new Set(modelPresets.map((p) => p.cliModel))
    const opts: { value: string; label: string }[] = [
      { value: '__default', label: 'CLI default (no --model)' },
      ...modelPresets.map((p) => ({
        value: p.cliModel,
        label: `${p.label} (${p.cliModel})`,
      })),
    ]
    if (modelValRaw && !presetIds.has(modelValRaw)) {
      opts.push({ value: modelValRaw, label: `${modelValRaw} (custom)` })
    }
    return opts
  }, [modelPresets, modelValRaw])
  const modelSelectValue = modelValRaw === '' ? '__default' : modelValRaw

  return (
    <>
      <SelectRow
        label="Conflict resolver agent"
        description="CLI launched in a new terminal when a Commit-triggered push hits a non-fast-forward and the auto-rebase has content conflicts. The agent resolves the rebase mid-flight; you re-click Commit to push."
        value={agent}
        onChange={(v) =>
          updateSettings({ conflictResolverAgent: normalizeConflictResolverAgent(v) })
        }
        options={BUILD_HARNESS_OPTIONS.map((o) => ({
          value: o.agent,
          label: o.label,
        }))}
      />
      <SelectRow
        label="Conflict resolver model"
        description="Passed to the conflict-resolver agent as --model when not “CLI default”."
        value={modelSelectValue}
        onChange={(v) =>
          updateSettings({
            conflictResolverModel:
              v === '__default' ? '' : normalizeConflictResolverModel(v),
          })
        }
        options={modelSelectOptions}
      />
    </>
  )
}

function McpServersSection() {
  const openFileTab = useAppStore((s) => s.openFileTab)
  const toggleSettings = useAppStore((s) => s.toggleSettings)
  const [servers, setServers] = useState<McpServer[]>([])
  const [configPaths, setConfigPaths] = useState<Record<string, string>>({})
  const [selectedAgent, setSelectedAgent] = useState<AgentType>('claude-code')

  const loadServers = () => {
    window.api.mcp.loadServers().then(setServers).catch(() => {})
  }

  useEffect(() => {
    loadServers()
    window.api.mcp.getConfigPaths().then(setConfigPaths).catch(() => {})
  }, [])

  // Refresh when window regains focus (user may have edited the file)
  useEffect(() => {
    const onFocus = () => loadServers()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const openConfig = () => {
    const path = configPaths[selectedAgent]
    if (path) {
      openFileTab(path)
      toggleSettings()
    }
  }

  const handleDelete = async (serverName: string) => {
    await window.api.mcp.removeServer(serverName)
    loadServers()
  }

  const configFileNames: Record<AgentType, string> = {
    'claude-code': '~/.claude.json',
    'codex': '~/.codex/config.toml',
    'gemini': '~/.gemini/settings.json',
    'cursor': '~/.cursor/mcp.json',
    'opencode': 'No known MCP config file',
    'pi-constell': '~/.pi/config.json',
  }
  const configFileName = configFileNames[selectedAgent]

  return (
    <div className={styles.mcpList}>
      <div className={styles.mcpAgentSelect}>
        <select
          className={styles.textInput}
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value as AgentType)}
        >
          {(Object.keys(AGENT_LABELS) as AgentType[]).map((agent) => (
            <option key={agent} value={agent}>{AGENT_LABELS[agent]}</option>
          ))}
        </select>
      </div>

      {servers.map((server) => (
        <McpServerCard
          key={server.id}
          server={server}
          onDelete={handleDelete}
          onOpenConfig={openConfig}
        />
      ))}

      <div className={styles.mcpCardMain} onClick={openConfig} style={{ cursor: 'pointer' }}>
        <div className={styles.mcpAvatarAdd}>+</div>
        <div className={styles.mcpCardText}>
          <div className={styles.rowLabel}>New MCP Server</div>
          <div className={styles.mcpCardSub}>Open {configFileName} to add a server</div>
        </div>
      </div>
    </div>
  )
}

type SettingsSectionBodyProps = {
  section: SettingsSectionId
  settings: Settings
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  requestRestart: () => void
  restarting: boolean
}

function SettingsSectionBody({
  section,
  settings,
  update,
  requestRestart,
  restarting,
}: SettingsSectionBodyProps) {
  switch (section) {
    case 'appearance':
      return (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Appearance</div>

          <div className={styles.settingBlock}>
            <div className={styles.settingBlockLabel}>Theme</div>
            <div className={styles.settingBlockDescription}>
              Choose the overall shell palette for panels, tabs, terminal, and editor surfaces.
            </div>
            <ThemePresetPicker
              value={settings.appearanceThemeId}
              onChange={(v) => update('appearanceThemeId', v)}
            />
          </div>

          <NumberRow
            label="Terminal font size"
            description="Font size in pixels for terminal tabs"
            value={settings.terminalFontSize}
            onChange={(v) => update('terminalFontSize', v)}
          />

          <NumberRow
            label="Editor font size"
            description="Font size in pixels for file and diff editors"
            value={settings.editorFontSize}
            onChange={(v) => update('editorFontSize', v)}
          />

          <ToggleRow
            label="Editor: full TypeScript checking"
            description="Runs Monaco semantic checks for standalone TS/JS files. Workspace files stay syntax-only here and should rely on the TypeScript LSP bridge for project-aware imports and types."
            value={settings.editorMonacoSemanticDiagnostics}
            onChange={(v) => update('editorMonacoSemanticDiagnostics', v)}
          />
        </div>
      )

    case 'sidebar':
      return <SidePanelSettingsSection />

    case 'general':
      return (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>General</div>

          <ToggleRow
            label="Confirm on close"
            description="Show confirmation when closing tabs with unsaved changes"
            value={settings.confirmOnClose}
            onChange={(v) => update('confirmOnClose', v)}
          />

          <ToggleRow
            label="Auto-save on blur"
            description="Automatically save files when switching away from a tab"
            value={settings.autoSaveOnBlur}
            onChange={(v) => update('autoSaveOnBlur', v)}
          />

          <ToggleRow
            label="Restore workspace"
            description="Restore the last active workspace when the app starts"
            value={settings.restoreWorkspace}
            onChange={(v) => update('restoreWorkspace', v)}
          />

          <ToggleRow
            label="Play chime when agent finishes"
            description="Play a short tone when an agent in a background workspace completes or fails"
            value={settings.playAgentDoneChime}
            onChange={(v) => update('playAgentDoneChime', v)}
          />

          <ToggleRow
            label="Inline diffs"
            description="Show diffs inline instead of side-by-side"
            value={settings.diffInline}
            onChange={(v) => update('diffInline', v)}
          />

          <ToggleRow
            label="Open full diff context by default"
            description="Start diff files with all unchanged lines visible. You can still override each file from its header."
            value={settings.diffShowFullContextByDefault}
            onChange={(v) => update('diffShowFullContextByDefault', v)}
          />

          <ToggleRow
            label="Search code in Quick Open (Cmd+F)"
            description="Uses fff to grep file contents alongside file-name matches. Results are labeled file or code."
            value={settings.quickOpenCodeSearchEnabled}
            onChange={(v) => update('quickOpenCodeSearchEnabled', v)}
          />

          <PiCommitMessageModelSettingsRow
            value={settings.piCommitMessageModel}
            onChange={(v) => update('piCommitMessageModel', v)}
          />

          <TextRow
            label="Default shell"
            description="Path to shell executable (leave empty for system default)"
            value={settings.defaultShell}
            onChange={(v) => update('defaultShell', v)}
            placeholder="/bin/zsh"
          />

          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>PR link provider</div>
              <div className={styles.rowDescription}>
                Set per project in Project Settings (gear icon in the sidebar).
              </div>
            </div>
          </div>

          <SelectRow
            label="Favorite editor"
            description="External editor to open workspaces in (⇧⌘O)"
            value={settings.favoriteEditor}
            onChange={(v) => update('favoriteEditor', v as FavoriteEditor)}
            options={[
              { value: 'cursor', label: 'Cursor' },
              { value: 'vscode', label: 'VS Code' },
              { value: 'zed', label: 'Zed' },
              { value: 'sublime', label: 'Sublime Text' },
              { value: 'webstorm', label: 'WebStorm' },
              { value: 'custom', label: 'Custom...' },
            ]}
          />

          {settings.favoriteEditor === 'custom' && (
            <TextRow
              label="Custom editor command"
              description="CLI command used to open a directory (e.g. nvim, emacs)"
              value={settings.favoriteEditorCustom}
              onChange={(v) => update('favoriteEditorCustom', v)}
              placeholder="code"
            />
          )}

          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>Restart app</div>
              <div className={styles.rowDescription}>
                Fully quit and reopen Constellagent so main-process and preload changes reload after pulls or rebuilds.
              </div>
            </div>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={requestRestart}
              disabled={restarting}
            >
              {restarting ? 'Restarting...' : 'Restart'}
            </button>
          </div>
        </div>
      )

    case 'linear':
      return (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Linear</div>
          <LinearSettingsSection
            apiKey={settings.linearApiKey}
            onKeyChange={(v) => update('linearApiKey', v)}
          />
        </div>
      )

    case 'conductor':
      return (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Conductor</div>
          <ConductorSettingsSection
            cursorApiKey={settings.conductorCursorApiKey}
            openaiApiKey={settings.conductorOpenaiApiKey}
            onCursorKeyChange={(v) => update('conductorCursorApiKey', v)}
            onOpenaiKeyChange={(v) => update('conductorOpenaiApiKey', v)}
          />
        </div>
      )

    case 'mcp':
      return (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>MCP Servers</div>
          <McpServersSection />
        </div>
      )

    case 'integrations':
      return (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Agent Integrations</div>
          <ClaudeHooksSection />
          <CodexHooksSection />

          <ToggleRow
            label="Auto-resume sessions"
            description="Offer to resume the last agent session when reopening a workspace"
            value={settings.sessionResumeEnabled}
            onChange={(v) => update('sessionResumeEnabled', v)}
          />
        </div>
      )

    case 'composio':
      return <ComposioSettingsSection />

    case 'worktree':
      return <WorktreeCredentialsSection />

    case 'skills':
      return <SkillsSubagentsSection />

    case 'shortcuts':
      return (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Keyboard Shortcuts</div>

          {SHORTCUTS.map((s) => (
            <div key={s.action} className={styles.shortcutRow}>
              <span className={styles.shortcutAction}>{s.action}</span>
              <kbd className={styles.kbd}>{s.keys}</kbd>
            </div>
          ))}
        </div>
      )

    default:
      return null
  }
}

export function SettingsPanel() {
  const settings = useAppStore((s) => s.settings)
  const tabs = useAppStore((s) => s.tabs)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const toggleSettings = useAppStore((s) => s.toggleSettings)
  const showConfirmDialog = useAppStore((s) => s.showConfirmDialog)
  const dismissConfirmDialog = useAppStore((s) => s.dismissConfirmDialog)
  const addToast = useAppStore((s) => s.addToast)
  const [restarting, setRestarting] = useState(false)
  const section = useAppStore((s) => s.settingsSection)
  const setSettingsSection = useAppStore((s) => s.setSettingsSection)

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    updateSettings({ [key]: value })
  }

  const triggerRestart = async () => {
    if (restarting) return
    setRestarting(true)
    try {
      await window.api.app.relaunch()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restart Constellagent'
      addToast({ id: crypto.randomUUID(), message, type: 'error' })
      setRestarting(false)
    }
  }

  const requestRestart = () => {
    if (restarting) return
    if (shouldConfirmAppRestart(settings.confirmOnClose, tabs)) {
      showConfirmDialog({
        title: 'Restart app',
        message: 'Restart Constellagent now? Some open files have unsaved changes that will be lost.',
        confirmLabel: 'Restart',
        tip: 'Use this after pulling or rebuilding so the main process and preload scripts fully reload.',
        onConfirm: () => {
          dismissConfirmDialog()
          void triggerRestart()
        },
      })
      return
    }
    void triggerRestart()
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleSettings()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleSettings])

  const activeBlurb =
    SETTINGS_SIDEBAR.find((item) => item.id === section)?.blurb
    ?? SETTINGS_SIDEBAR[0].blurb

  return (
    <FloatingPanel variant="fullscreen" testId="settings-panel">
      <FloatingPanel.Titlebar trafficLightPad>
        <Tooltip label="Back" shortcut="⌘,">
          <button
            type="button"
            className={styles.backBtn}
            onClick={toggleSettings}
            aria-label="Close settings"
          >
            <ChevronLeft size={16} strokeWidth={2} aria-hidden />
          </button>
        </Tooltip>
        <h2 className={styles.title}>Settings</h2>
      </FloatingPanel.Titlebar>

      <FloatingPanel.Body className={styles.settingsBody}>
        <div className={styles.settingsShell}>
          <aside className={styles.settingsNav} aria-label="Settings categories">
            <div role="tablist" aria-orientation="vertical" className={styles.settingsTabs}>
              {SETTINGS_SIDEBAR.map((item) => {
                const selected = section === item.id

                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    id={`settings-tab-${item.id}`}
                    aria-controls="settings-pane"
                    className={`${styles.settingsTab} ${selected ? styles.settingsTabActive : ''}`}
                    onClick={() => setSettingsSection(item.id)}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          </aside>

          <div
            role="tabpanel"
            aria-labelledby={`settings-tab-${section}`}
            id="settings-pane"
            className={styles.settingsPane}
          >
            <div className={styles.inner}>
              <p className={styles.subtitle}>{activeBlurb}</p>
              <SettingsSectionBody
                section={section}
                settings={settings}
                update={update}
                requestRestart={requestRestart}
                restarting={restarting}
              />
            </div>
          </div>
        </div>
      </FloatingPanel.Body>
    </FloatingPanel>
  )
}
