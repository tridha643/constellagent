import { basename } from 'node:path'
import type {
  HostUiResponse,
  SessionAttachment,
  SessionDriverEvent,
  SessionRef,
  Unsubscribe,
} from '@pi-gui/session-driver'
import type { AgentChatProviderSessionRef } from '../../shared/agent-chat-types'
import type { ConductorComposerAttachment } from '../../shared/conductor-attachments'
import type { SessionExtensionUiStateRecord } from '../../shared/pi/pi-desktop-state'
import type { ModelPreset } from '../../shared/plan-build-command'
import { PI_CONDUCTOR_MODEL_PRESETS } from '../../shared/conductor-model-utils'
import {
  buildPiConductorModelPresets,
  resolveStoredPiModelId,
} from '../../shared/pi-conductor-model-presets'
import type { AgentDriver, AgentTurnContext } from './agent-driver'
import { getConstellPiHost } from '../pi-host-service'
import { listPiModels } from '../pi-models'

export class PiConductorDriver implements AgentDriver {
  readonly provider = 'pi' as const

  private readonly piHost = getConstellPiHost()
  private readonly refsBySession = new Map<string, SessionRef>()
  private readonly extensionUiBySession = new Map<string, SessionExtensionUiStateRecord>()
  private readonly persistentSubscriptions = new Map<string, Unsubscribe>()

  checkAuth(): string | null {
    return null
  }

  async runTurn(ctx: AgentTurnContext): Promise<void> {
    const piRef = await this.ensurePiSession(ctx)
    this.refsBySession.set(ctx.sessionRef.sessionId, piRef)
    await this.applyTurnConfig(piRef, ctx)

    const abort = () => {
      void this.piHost.driver.cancelCurrentRun(piRef).catch(() => undefined)
    }
    ctx.signal.addEventListener('abort', abort, { once: true })

    let terminalError: Error | null = null
    const unsubscribe = this.piHost.driver.subscribe(piRef, (event) => {
      const err = this.handleDriverEvent(ctx, piRef, event)
      if (err) terminalError = err
    })

    try {
      await this.piHost.driver.sendUserMessage(piRef, {
        text: ctx.text,
        ...sessionAttachmentsFromConductor(ctx.attachments),
      })
      if (terminalError) throw terminalError
    } finally {
      ctx.signal.removeEventListener('abort', abort)
      unsubscribe()
      this.ensurePersistentUiSubscription(ctx.sessionRef.sessionId, piRef, ctx.setPiExtensionUi)
    }
  }

  closeSession(sessionId: string): void {
    this.persistentSubscriptions.get(sessionId)?.()
    this.persistentSubscriptions.delete(sessionId)
    this.extensionUiBySession.delete(sessionId)
    const ref = this.refsBySession.get(sessionId)
    this.refsBySession.delete(sessionId)
    if (ref) {
      void this.piHost.driver.closeSession(ref).catch(() => undefined)
    }
  }

  getContextUsage(sessionId: string): number | null {
    const ref = this.refsBySession.get(sessionId)
    if (!ref) return null
    const usage = this.piHost.driver.getContextUsageSnapshot(ref)
    return usage?.usedTokens ?? null
  }

  async respondHostUi(sessionId: string, response: HostUiResponse): Promise<void> {
    const ref = this.refsBySession.get(sessionId)
    if (!ref) return
    await this.piHost.driver.respondToHostUiRequest(ref, response)
    this.refreshExtensionUi(sessionId, ref)
  }

  sendExtensionTuiInput(sessionId: string, data: string): void {
    const ref = this.refsBySession.get(sessionId)
    if (!ref) return
    this.piHost.driver.deliverExtensionTuiInput(ref, data)
  }

  getPiExtensionUi(sessionId: string): SessionExtensionUiStateRecord | null {
    return this.extensionUiBySession.get(sessionId) ?? null
  }

  async listModelsForWorkspace(workspacePath: string): Promise<readonly ModelPreset[]> {
    await this.piHost.initialize()
    const { workspace } = await this.piHost.driver.syncWorkspace(
      workspacePath,
      basename(workspacePath) || 'Workspace',
    )
    const snapshot = await this.piHost.driver.runtimeSupervisor.refreshRuntime(workspace)
    let cliModels: Awaited<ReturnType<typeof listPiModels>> = []
    try {
      cliModels = await listPiModels({ forceRefresh: true })
    } catch {
      // Runtime + static presets still populate the Conductor list when `pi --list-models` fails.
    }

    return buildPiConductorModelPresets({
      staticPresets: PI_CONDUCTOR_MODEL_PRESETS,
      cliModels,
      runtimeModels: snapshot.models,
      enabledModelPatterns: snapshot.settings.enabledModelPatterns,
    })
  }

  private async ensurePiSession(ctx: AgentTurnContext): Promise<SessionRef> {
    await this.piHost.initialize()

    if (ctx.providerSession) {
      const existing = toSessionRef(ctx.providerSession)
      await this.piHost.driver.openSession(existing)
      return existing
    }

    const { workspace } = await this.piHost.driver.syncWorkspace(
      ctx.workspacePath,
      basename(ctx.workspacePath) || 'Workspace',
    )
    const runtimeSnapshot = await this.piHost.driver.runtimeSupervisor.refreshRuntime(workspace)
    let cliModels: Awaited<ReturnType<typeof listPiModels>> = []
    try {
      cliModels = await listPiModels({ forceRefresh: true })
    } catch {
      // Fall back to runtime-only resolution when the CLI catalog is unavailable.
    }
    const snapshot = await this.piHost.driver.createSession(workspace, {
      title: 'Conductor Pi',
      ...initialPiModel(ctx.model, runtimeSnapshot.models, cliModels),
      initialThinkingLevel: ctx.thinkingLevel,
    })
    ctx.setProviderSession?.(snapshot.ref)
    return snapshot.ref
  }

  private async applyTurnConfig(piRef: SessionRef, ctx: AgentTurnContext): Promise<void> {
    const workspace = { workspaceId: piRef.workspaceId, path: ctx.workspacePath }
    const runtimeSnapshot = await this.piHost.driver.runtimeSupervisor.refreshRuntime(workspace)
    let cliModels: Awaited<ReturnType<typeof listPiModels>> = []
    try {
      cliModels = await listPiModels({ forceRefresh: true })
    } catch {
      // Fall back to runtime-only resolution when the CLI catalog is unavailable.
    }
    const model = resolvePiSessionModel(ctx.model, runtimeSnapshot.models, cliModels)
    if (model) {
      await this.piHost.driver.setSessionModel(piRef, model)
    }
    await this.piHost.driver.setSessionThinkingLevel(piRef, ctx.thinkingLevel).catch(() => undefined)
  }

  private handleDriverEvent(
    ctx: AgentTurnContext,
    piRef: SessionRef,
    event: SessionDriverEvent,
  ): Error | null {
    if (event.type === 'hostUiRequest') {
      this.refreshExtensionUi(ctx.sessionRef.sessionId, piRef, ctx.setPiExtensionUi)
      if (event.request.kind === 'notify') {
        ctx.emit(rewriteSessionRef(event, ctx.sessionRef))
      }
      return null
    }

    if (
      event.type === 'assistantDelta' ||
      event.type === 'toolStarted' ||
      event.type === 'toolUpdated' ||
      event.type === 'toolFinished'
    ) {
      ctx.emit(rewriteSessionRef(event, ctx.sessionRef))
      return null
    }

    if (event.type === 'runFailed') {
      return new Error(event.error.message)
    }

    return null
  }

  private refreshExtensionUi(
    sessionId: string,
    piRef: SessionRef,
    notify?: (ui: SessionExtensionUiStateRecord | null) => void,
  ): void {
    const snap = this.piHost.driver.getSessionExtensionUiSnapshot(piRef)
    const ui = {
      statuses: snap.statuses,
      widgets: snap.widgets,
      pendingDialogs: snap.pendingDialogs,
      title: snap.title,
      editorText: snap.editorText,
      tuiCustom: snap.tuiCustom,
    }
    this.extensionUiBySession.set(sessionId, ui)
    notify?.(ui)
  }

  private ensurePersistentUiSubscription(
    sessionId: string,
    piRef: SessionRef,
    notify?: (ui: SessionExtensionUiStateRecord | null) => void,
  ): void {
    if (this.persistentSubscriptions.has(sessionId)) return
    const unsubscribe = this.piHost.driver.subscribe(piRef, (event) => {
      if (event.type === 'hostUiRequest') {
        this.refreshExtensionUi(sessionId, piRef, notify)
      }
    })
    this.persistentSubscriptions.set(sessionId, unsubscribe)
  }
}

function toSessionRef(ref: AgentChatProviderSessionRef): SessionRef {
  return { workspaceId: ref.workspaceId, sessionId: ref.sessionId }
}

function parsePiModel(model: string): { provider: string; modelId: string } | null {
  const trimmed = model.trim()
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash >= trimmed.length - 1) return null
  return {
    provider: trimmed.slice(0, slash),
    modelId: trimmed.slice(slash + 1),
  }
}

function initialPiModel(
  model: string,
  runtimeModels: Parameters<typeof resolveStoredPiModelId>[1],
  cliModels: Parameters<typeof resolveStoredPiModelId>[2],
):
  | { initialModel: { provider: string; modelId: string } }
  | Record<string, never> {
  const parsed = parsePiModel(resolveStoredPiModelId(model, runtimeModels, cliModels))
  return parsed ? { initialModel: parsed } : {}
}

function resolvePiSessionModel(
  model: string,
  runtimeModels: Parameters<typeof resolveStoredPiModelId>[1],
  cliModels: Parameters<typeof resolveStoredPiModelId>[2],
): { provider: string; modelId: string } | null {
  const resolvedId = resolveStoredPiModelId(model, runtimeModels, cliModels)
  return parsePiModel(resolvedId)
}

function sessionAttachmentsFromConductor(
  attachments: readonly ConductorComposerAttachment[] | undefined,
): { attachments: readonly SessionAttachment[] } | Record<string, never> {
  const converted =
    attachments?.flatMap((attachment): SessionAttachment[] => {
      if (attachment.kind !== 'image') return []
      return [
        {
          kind: 'image',
          name: attachment.name,
          mimeType: attachment.mimeType,
          data: attachment.data,
        },
      ]
    }) ?? []
  return converted.length > 0 ? { attachments: converted } : {}
}

function rewriteSessionRef<T extends SessionDriverEvent>(event: T, sessionRef: SessionRef): T {
  return {
    ...event,
    sessionRef,
  }
}
