import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/app-store'
import type {
  Settings,
  FavoriteEditor,
  McpServer,
  AgentType,
  SkillEntry,
  SubagentEntry,
} from '../../store/types'
import {
  normalizeLinearIssueCodingAgent,
  normalizeLinearIssueCodingModel,
  normalizeLinearIssueScope,
  normalizeLinearIssuesPriorityPreset,
} from '../../store/types'
import type { PlanAgent } from '../../../shared/agent-plan-path'
import { BUILD_HARNESS_OPTIONS, PLAN_MODEL_PRESETS } from '../../../shared/plan-build-command'
import {
  getDefaultWorktreeCredentialRules,
  normalizeWorktreeCredentialPattern,
  type WorktreeCredentialRuleKind,
} from '../../../shared/worktree-credentials'
import { Tooltip } from '../Tooltip/Tooltip'
import { APPEARANCE_THEME_OPTIONS, type AppearanceThemeId } from '../../theme/appearance'
import { shouldConfirmAppRestart } from './restart-app'
import { linearFetchViewer } from '../../linear/linear-api'
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
  { action: 'Toggle sidebar', keys: '⌘B' },
  { action: 'Toggle right panel', keys: '⌥⌘B' },
  { action: 'Files panel', keys: '⇧⌘E' },
  { action: 'Changes panel', keys: '⇧⌘G' },
  { action: 'Focus terminal', keys: '⌘J' },
  { action: 'Increase font size', keys: '⌘+' },
  { action: 'Decrease font size', keys: '⌘−' },
  { action: 'Reset font size', keys: '⌘0' },
  { action: 'Open in editor', keys: '⇧⌘O' },
  { action: 'Context history', keys: '⇧⌘K' },
  { action: 'Plan picker (search + filter by agent)', keys: '⇧⌘M' },
  { action: 'Settings', keys: '⌘,' },
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

function SelectRow({ label, description, value, onChange, options }: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
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
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
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
      await window.api.skills.sync(dirPath, activeProject.repoPath)
      await window.api.skills.kvSave(activeProject.repoPath, skill).catch(() => {})
    }
  }

  const handleRemoveSkill = async (skill: SkillEntry) => {
    if (activeProject) {
      await window.api.skills.remove(skill.name, activeProject.repoPath)
      await window.api.skills.kvRemove(activeProject.repoPath, skill.name).catch(() => {})
    }
    removeSkill(skill.id)
  }

  const handleToggleSkill = async (skill: SkillEntry) => {
    const newEnabled = !skill.enabled
    updateSkill(skill.id, { enabled: newEnabled })
    if (activeProject) {
      if (newEnabled) {
        await window.api.skills.sync(skill.sourcePath, activeProject.repoPath)
      } else {
        await window.api.skills.remove(skill.name, activeProject.repoPath)
      }
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
      await window.api.subagents.sync(filePath, activeProject.repoPath)
      await window.api.subagents.kvSave(activeProject.repoPath, subagent).catch(() => {})
    }
  }

  const handleRemoveSubagent = async (subagent: SubagentEntry) => {
    if (activeProject) {
      await window.api.subagents.remove(subagent.name, activeProject.repoPath)
      await window.api.subagents.kvRemove(activeProject.repoPath, subagent.name).catch(() => {})
    }
    removeSubagent(subagent.id)
  }

  const handleToggleSubagent = async (subagent: SubagentEntry) => {
    const newEnabled = !subagent.enabled
    updateSubagent(subagent.id, { enabled: newEnabled })
    if (activeProject) {
      if (newEnabled) {
        await window.api.subagents.sync(subagent.sourcePath, activeProject.repoPath)
      } else {
        await window.api.subagents.remove(subagent.name, activeProject.repoPath)
      }
      await window.api.subagents.kvSave(activeProject.repoPath, { ...subagent, enabled: newEnabled }).catch(() => {})
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Skills & Subagents</div>

      <div className={styles.subsectionLabel}>Skills</div>
      {settings.skills.length === 0 && (
        <div className={styles.emptyHint}>No skills configured. Add a directory containing a SKILL.md file.</div>
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

      {expanded && (
        <div className={styles.mcpCardExpanded}>
          <div className={styles.mcpCardDetail}>
            <span className={styles.mcpDetailLabel}>Command</span>
            <span className={styles.mcpDetailValue}>{server.command} {server.args.join(' ')}</span>
          </div>
        </div>
      )}
    </div>
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

export function SettingsPanel() {
  const settings = useAppStore((s) => s.settings)
  const tabs = useAppStore((s) => s.tabs)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const toggleSettings = useAppStore((s) => s.toggleSettings)
  const showConfirmDialog = useAppStore((s) => s.showConfirmDialog)
  const dismissConfirmDialog = useAppStore((s) => s.dismissConfirmDialog)
  const addToast = useAppStore((s) => s.addToast)
  const [restarting, setRestarting] = useState(false)

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

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerLeft}>
            <Tooltip label="Back" shortcut="⌘,">
              <button className={styles.backBtn} onClick={toggleSettings}>‹</button>
            </Tooltip>
            <div className={styles.headerText}>
              <h2 className={styles.title}>Settings</h2>
              <p className={styles.subtitle}>Tune appearance, integrations, shortcuts, and worktree defaults.</p>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.inner}>
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
            label="T3 Code: hide panels"
            description="Collapse sidebar and right panel when opening T3 Code (⚡)"
            value={settings.t3CodeCollapseSidePanels}
            onChange={(v) => update('t3CodeCollapseSidePanels', v)}
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

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Linear</div>
          <LinearSettingsSection
            apiKey={settings.linearApiKey}
            onKeyChange={(v) => update('linearApiKey', v)}
          />
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>MCP Servers</div>
          <McpServersSection />
        </div>

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

        <WorktreeCredentialsSection />

        <SkillsSubagentsSection />

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Keyboard Shortcuts</div>

          {SHORTCUTS.map((s) => (
            <div key={s.action} className={styles.shortcutRow}>
              <span className={styles.shortcutAction}>{s.action}</span>
              <kbd className={styles.kbd}>{s.keys}</kbd>
            </div>
          ))}
        </div>
        </div>
      </div>
    </div>
  )
}
