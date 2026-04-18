import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAppStore } from '../../store/app-store'
import {
  isAgentPlanPath,
  agentForPlanPath,
  AGENT_TO_PLAN_DIR,
  pathsEqualOrAlias,
  type PlanMeta,
  type PlanAgent,
} from '../../../shared/agent-plan-path'
import {
  BUILD_HARNESS_OPTIONS,
  PLAN_MODEL_PRESETS,
  buildPlanAgentCommand,
  canonicalPlanModelValue,
  effectivePlanHarness,
  findPlanModelPreset,
  isModelLabelFromOtherHarness,
  planAgentToPtyAgentType,
  type PiModelOption,
} from '../../../shared/plan-build-command'
import { resolvePiModelSelectState } from '../../../shared/pi-models'
import type { AgentType } from '../../store/types'
import styles from './PlanAgentToolbar.module.css'

const BUILD_TIMEOUT_MS = 5 * 60 * 1000

type PiModelLoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

const RELOCATE_TARGETS: { agent: PlanAgent; label: string }[] = [
  { agent: 'cursor', label: 'Cursor' },
  { agent: 'claude-code', label: 'Claude' },
  { agent: 'codex', label: 'Codex' },
  { agent: 'gemini', label: 'Gemini' },
  { agent: 'opencode', label: 'OpenCode' },
  { agent: 'pi-constell', label: 'PI Constell' },
]

export interface PlanAgentToolbarProps {
  filePath: string
  worktreePath?: string
  /** Browser tab id for relocate/move + store updates (split panes must pass the real tab id, not the pane id). */
  hostTabId: string | null
}

export function PlanAgentToolbar({ filePath, worktreePath, hostTabId }: PlanAgentToolbarProps) {
  const [meta, setMeta] = useState<PlanMeta>({ built: false, codingAgent: null, buildHarness: null })
  const [relocateOpen, setRelocateOpen] = useState(false)
  const [customAgent, setCustomAgent] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const [building, setBuilding] = useState(false)
  const [userHome, setUserHome] = useState<string | undefined>(undefined)
  const [piModels, setPiModels] = useState<PiModelOption[]>([])
  const [piModelLoadState, setPiModelLoadState] = useState<PiModelLoadState>('idle')
  const relocateRef = useRef<HTMLDivElement>(null)

  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const removeTab = useAppStore((s) => s.removeTab)
  const addToast = useAppStore((s) => s.addToast)
  const showConfirmDialog = useAppStore((s) => s.showConfirmDialog)
  const dismissConfirmDialog = useAppStore((s) => s.dismissConfirmDialog)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const launchAgentTerminal = useAppStore((s) => s.launchAgentTerminalWithCommand)
  const retargetPlanFilePathEverywhere = useAppStore((s) => s.retargetPlanFilePathEverywhere)
  const setPlanBuildTerminalForPlan = useAppStore((s) => s.setPlanBuildTerminalForPlan)
  const workspace = useAppStore((s) =>
    s.workspaces.find((w) => w.worktreePath === worktreePath),
  )

  useEffect(() => {
    void window.api.app.getHomeDir().then(setUserHome).catch(() => {})
  }, [])

  const isPlan = isAgentPlanPath(worktreePath ?? '', filePath, userHome)
  const currentAgent = agentForPlanPath(worktreePath ?? '', filePath, userHome)

  const effectiveHarness = useMemo(
    () => effectivePlanHarness(meta.buildHarness, currentAgent as PlanAgent | null),
    [meta.buildHarness, currentAgent],
  )
  const piModelSelectState = useMemo(
    () => resolvePiModelSelectState(piModels, meta.codingAgent),
    [piModels, meta.codingAgent],
  )

  const agentPresets = useMemo(() => {
    if (!effectiveHarness) return []
    if (effectiveHarness === 'pi-constell') {
      return piModelSelectState.presets
    }
    return PLAN_MODEL_PRESETS[effectiveHarness] ?? []
  }, [effectiveHarness, piModelSelectState.presets])
  const modelSelectValue = useMemo(() => {
    if (!effectiveHarness) return ''
    if (effectiveHarness === 'pi-constell') return piModelSelectState.value
    if (!meta.codingAgent) return ''
    return canonicalPlanModelValue(effectiveHarness, meta.codingAgent)
  }, [effectiveHarness, meta.codingAgent, piModelSelectState.value])
  const hasSelectedAgentPreset = effectiveHarness === 'pi-constell'
    ? piModelSelectState.hasSelectedPreset
    : !!modelSelectValue && agentPresets.some((preset) => preset.cliModel === modelSelectValue)
  const supportsCustomAgentInput = effectiveHarness !== 'pi-constell'
  const modelSelectPlaceholder = useMemo(() => {
    if (effectiveHarness !== 'pi-constell') return 'No model'
    switch (piModelLoadState) {
      case 'loading':
        return 'Loading PI models...'
      case 'empty':
        return 'No PI models found'
      case 'error':
        return 'PI models unavailable'
      default:
        return 'No model'
    }
  }, [effectiveHarness, piModelLoadState])

  const folderHarnessLabel = useMemo(
    () => RELOCATE_TARGETS.find((t) => t.agent === currentAgent)?.label ?? 'folder',
    [currentAgent],
  )

  useEffect(() => {
    if (effectiveHarness !== 'pi-constell') {
      setPiModels([])
      setPiModelLoadState('idle')
      return
    }
    let cancelled = false
    setPiModelLoadState('loading')
    window.api.app.listPiModels().then((models) => {
      if (cancelled) return
      setPiModels(models)
      setPiModelLoadState(models.length > 0 ? 'ready' : 'empty')
    }).catch(() => {
      if (cancelled) return
      setPiModels([])
      setPiModelLoadState('error')
    })
    return () => { cancelled = true }
  }, [effectiveHarness])

  useEffect(() => {
    if (effectiveHarness === 'pi-constell' && customAgent) {
      setCustomAgent(false)
    }
  }, [effectiveHarness, customAgent])

  const loadMeta = useCallback(async () => {
    if (!isPlan) return
    try {
      const m = await window.api.fs.readPlanMeta(filePath)
      setMeta(m)
    } catch { /* ignore — file may have been moved */ }
  }, [filePath, isPlan])

  useEffect(() => { void loadMeta() }, [loadMeta])

  useEffect(() => {
    const watchRoots: string[] = []
    if (worktreePath) watchRoots.push(worktreePath)
    if (isPlan && filePath) {
      const i = filePath.lastIndexOf('/')
      if (i > 0) watchRoots.push(filePath.slice(0, i))
    }
    const unique = [...new Set(watchRoots)]
    if (unique.length === 0) return
    for (const d of unique) void window.api.fs.watchDir(d)
    const cleanup = window.api.fs.onDirChanged((changedDir) => {
      if (!unique.some((w) => pathsEqualOrAlias(changedDir, w))) return
      void loadMeta()
    })
    return () => {
      for (const d of unique) void window.api.fs.unwatchDir(d)
      cleanup()
    }
  }, [worktreePath, filePath, isPlan, loadMeta])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!worktreePath || detail?.worktreePath !== worktreePath) return
      void loadMeta()
    }
    window.addEventListener('git:files-changed', handler)
    return () => window.removeEventListener('git:files-changed', handler)
  }, [worktreePath, loadMeta])

  useEffect(() => {
    if (!relocateOpen) return
    const handler = (e: MouseEvent) => {
      if (relocateRef.current && !relocateRef.current.contains(e.target as Node)) {
        setRelocateOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [relocateOpen])

  const handleBuild = useCallback(async () => {
    if (!worktreePath || !workspace) return

    const harness = effectivePlanHarness(meta.buildHarness, currentAgent as PlanAgent | null)
    if (!harness) {
      addToast({ id: crypto.randomUUID(), message: 'Could not determine build harness for this plan', type: 'error' })
      return
    }

    if (!meta.codingAgent) {
      addToast({ id: crypto.randomUUID(), message: 'Select a model before building', type: 'error' })
      return
    }

    const matchesHarnessPreset = !!findPlanModelPreset(harness, meta.codingAgent)
    const modelOkForHarness =
      harness === 'pi-constell'
        ? true
        : (matchesHarnessPreset || !isModelLabelFromOtherHarness(harness, meta.codingAgent))
    if (!modelOkForHarness) {
      addToast({
        id: crypto.randomUUID(),
        message: 'This model name is for another harness; choose a model for the selected harness (or Custom… with a raw CLI id).',
        type: 'error',
      })
      return
    }

    let planAbsPath = filePath
    const onDiskAgent = agentForPlanPath(worktreePath, filePath, userHome) as PlanAgent | null
    if (onDiskAgent && onDiskAgent !== harness) {
      try {
        const oldPath = filePath
        planAbsPath = await window.api.fs.relocateAgentPlan(worktreePath, filePath, harness, 'move')
        retargetPlanFilePathEverywhere(oldPath, planAbsPath)
        const harnessLabel = BUILD_HARNESS_OPTIONS.find((o) => o.agent === harness)?.label ?? harness
        addToast({
          id: crypto.randomUUID(),
          message: `Plan moved to ${AGENT_TO_PLAN_DIR[harness]} for ${harnessLabel}`,
          type: 'info',
        })
      } catch (err) {
        addToast({
          id: crypto.randomUUID(),
          message: `Failed to move plan: ${err instanceof Error ? err.message : 'unknown error'}`,
          type: 'error',
        })
        return
      }
    }

    const { command } = buildPlanAgentCommand(harness, worktreePath, planAbsPath, meta.codingAgent)

    try {
      const planName = planAbsPath.split('/').pop()?.replace(/\.\w+$/, '') ?? 'Plan'
      const tabId = await launchAgentTerminal({
        workspaceId: workspace.id,
        worktreePath,
        title: `Build: ${planName}`,
        command,
        agentType: planAgentToPtyAgentType(harness) as AgentType,
      })
      setPlanBuildTerminalForPlan(planAbsPath, tabId)
      setBuilding(true)
      setActiveTab(tabId)
    } catch {
      addToast({ id: crypto.randomUUID(), message: 'Failed to launch build terminal', type: 'error' })
    }
  }, [
    worktreePath,
    workspace,
    currentAgent,
    meta.buildHarness,
    meta.codingAgent,
    filePath,
    userHome,
    retargetPlanFilePathEverywhere,
    launchAgentTerminal,
    setPlanBuildTerminalForPlan,
    setActiveTab,
    addToast,
  ])

  useEffect(() => {
    if (!building || !workspace) return

    const unsub = window.api.claude.onNotifyWorkspace((wsId) => {
      if (wsId !== workspace.id) return
      setBuilding(false)
      window.api.fs.updatePlanMeta(filePath, { built: true }).then((updated) => {
        setMeta(updated)
        addToast({ id: crypto.randomUUID(), message: 'Plan build complete', type: 'info' })
      }).catch(() => {})
    })

    const timeout = setTimeout(() => setBuilding(false), BUILD_TIMEOUT_MS)

    return () => { unsub(); clearTimeout(timeout) }
  }, [building, workspace, filePath, addToast])

  const handleUnsetBuilt = useCallback(async () => {
    try {
      const updated = await window.api.fs.updatePlanMeta(filePath, { built: false })
      setMeta(updated)
    } catch {
      addToast({ id: crypto.randomUUID(), message: 'Failed to update plan meta', type: 'error' })
    }
  }, [filePath, addToast])

  const handleHarnessSelect = useCallback(async (value: string) => {
    const nextHarness = value === '__auto' ? null : (value as PlanAgent)
    const prevEffective = effectivePlanHarness(meta.buildHarness, currentAgent as PlanAgent | null)
    const nextEffective = effectivePlanHarness(nextHarness, currentAgent as PlanAgent | null)
    try {
      const patch: Partial<PlanMeta> = { buildHarness: nextHarness }
      if (prevEffective !== nextEffective) patch.codingAgent = null
      const updated = await window.api.fs.updatePlanMeta(filePath, patch)
      setMeta(updated)
    } catch {
      addToast({ id: crypto.randomUUID(), message: 'Failed to update build harness', type: 'error' })
    }
  }, [filePath, meta.buildHarness, currentAgent, addToast])

  const handleAgentSelect = useCallback(async (value: string) => {
    if (value === '__custom') {
      if (!supportsCustomAgentInput) return
      setCustomAgent(true)
      setCustomInput(meta.codingAgent ?? '')
      return
    }
    try {
      const updated = await window.api.fs.updatePlanMeta(filePath, { codingAgent: value || null })
      setMeta(updated)
    } catch {
      addToast({ id: crypto.randomUUID(), message: 'Failed to update coding agent', type: 'error' })
    }
  }, [filePath, meta.codingAgent, addToast, supportsCustomAgentInput])

  const handleCustomAgentSubmit = useCallback(async () => {
    setCustomAgent(false)
    const val = customInput.trim() || null
    try {
      const updated = await window.api.fs.updatePlanMeta(filePath, { codingAgent: val })
      setMeta(updated)
    } catch {
      addToast({ id: crypto.randomUUID(), message: 'Failed to update coding agent', type: 'error' })
    }
  }, [filePath, customInput, addToast])

  const handleRelocate = useCallback(async (targetAgent: PlanAgent, mode: 'copy' | 'move') => {
    if (!worktreePath) return
    setRelocateOpen(false)

    const execute = async () => {
      try {
        const newPath = await window.api.fs.relocateAgentPlan(worktreePath, filePath, targetAgent, mode)
        addToast({
          id: crypto.randomUUID(),
          message: `Plan ${mode === 'move' ? 'moved' : 'copied'} to ${AGENT_TO_PLAN_DIR[targetAgent]}`,
          type: 'info',
        })
        if (mode === 'move' && hostTabId) {
          removeTab(hostTabId)
        }
        openMarkdownPreview(newPath)
      } catch (err) {
        addToast({
          id: crypto.randomUUID(),
          message: `Failed to ${mode} plan: ${err instanceof Error ? err.message : 'unknown error'}`,
          type: 'error',
        })
      }
    }

    if (mode === 'move') {
      showConfirmDialog({
        title: 'Move plan file',
        message: `Move this plan to ${AGENT_TO_PLAN_DIR[targetAgent]}? The original file will be deleted.`,
        confirmLabel: 'Move',
        destructive: true,
        onConfirm: () => {
          dismissConfirmDialog()
          void execute()
        },
      })
    } else {
      await execute()
    }
  }, [worktreePath, filePath, hostTabId, addToast, openMarkdownPreview, removeTab, showConfirmDialog, dismissConfirmDialog])

  if (!isPlan || !worktreePath) return null

  return (
    <div className={styles.toolbarActions}>
      <select
        className={styles.harnessSelect}
        value={meta.buildHarness === null ? '__auto' : meta.buildHarness}
        onChange={(e) => void handleHarnessSelect(e.target.value)}
        title="CLI agent for Build (moves plan into this harness folder if needed)"
      >
        <option value="__auto">Match folder ({folderHarnessLabel})</option>
        {BUILD_HARNESS_OPTIONS.map(({ agent, label }) => (
          <option key={agent} value={agent}>{label}</option>
        ))}
      </select>
      {customAgent && supportsCustomAgentInput ? (
        <input
          className={styles.customAgentInput}
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleCustomAgentSubmit(); if (e.key === 'Escape') setCustomAgent(false) }}
          onBlur={() => void handleCustomAgentSubmit()}
          placeholder="Model name…"
          autoFocus
        />
      ) : (
        <select
          className={styles.agentSelect}
          value={modelSelectValue}
          onChange={(e) => void handleAgentSelect(e.target.value)}
          title="Model for selected harness (value is the CLI --model id)"
        >
          <option value="">{modelSelectPlaceholder}</option>
          {agentPresets.map((p) => (
            <option key={p.cliModel} value={p.cliModel}>
              {p.label} ({p.cliModel})
            </option>
          ))}
          {effectiveHarness && meta.codingAgent
            && !hasSelectedAgentPreset && (
            <option value={modelSelectValue}>{modelSelectValue}</option>
          )}
          {supportsCustomAgentInput && <option value="__custom">Custom…</option>}
        </select>
      )}

      {meta.built ? (
        <button
          type="button"
          className={`${styles.builtBadge} ${styles.builtBadgeYes}`}
          onClick={() => void handleUnsetBuilt()}
          title="Click to mark as not built"
        >
          Built ✓
        </button>
      ) : building ? (
        <span className={styles.buildSpinner} title="Building…">
          <span className={styles.buildSpinnerDot} />
        </span>
      ) : (
        <button
          type="button"
          className={styles.buildButton}
          onClick={() => void handleBuild()}
          title="Launch agent to build this plan"
        >
          Build
        </button>
      )}

      <div className={styles.relocateWrap} ref={relocateRef}>
        <button
          type="button"
          className={styles.relocateButton}
          onClick={() => setRelocateOpen(!relocateOpen)}
          title="Copy or move to another agent's plan folder"
        >
          ↗
        </button>
        {relocateOpen && (
          <div className={styles.relocateDropdown}>
            {RELOCATE_TARGETS.filter((t) => t.agent !== currentAgent).map((t) => (
              <div key={t.agent} className={styles.relocateGroup}>
                <button
                  type="button"
                  className={styles.relocateItem}
                  onClick={() => void handleRelocate(t.agent, 'copy')}
                >
                  Copy to {t.label}
                </button>
                <button
                  type="button"
                  className={styles.relocateItem}
                  onClick={() => void handleRelocate(t.agent, 'move')}
                >
                  Move to {t.label}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
