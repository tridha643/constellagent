// JSON-RPC-shaped dispatcher exposed to paired iPhones over the secure WS channel.
// Mirrors phodex-bridge's per-domain handlers (git/workspace/session/annotation)
// but delegates to constellagent's existing main-process services so we never
// re-implement state that already lives in conductor-chat.db / .git stores.

import { readFile, stat } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'
import { z, type ZodTypeAny } from 'zod'
import {
  annotationCreateParamsSchema,
  annotationListParamsSchema,
  annotationResolveParamsSchema,
  gitBranchSwitchParamsSchema,
  gitCommitParamsSchema,
  gitDiffParamsSchema,
  gitWorktreeParamsSchema,
  mobileRpcRequestSchema,
  modelListParamsSchema,
  planDecisionParamsSchema,
  sessionCancelParamsSchema,
  sessionHistoryParamsSchema,
  sessionListParamsSchema,
  sessionReplyParamsSchema,
  sessionSetPlanParamsSchema,
  sessionResumeParamsSchema,
  sessionStartParamsSchema,
  workspaceReadParamsSchema,
  type MobileRpcMethod,
  type MobileRpcRequest,
  type MobileRpcResponse,
} from '@constellagent/mobile-protocol'
import type { AgentChatSessionState } from '../shared/agent-chat-types'
import { APPROVE_PLAN_MESSAGE } from '../shared/plan-approval'
import type { AgentChatHost } from './agent-chat-host'
import type { GitService as GitServiceType } from './git-service'
import type { AnnotationService as AnnotationServiceType } from './annotation-service'
import {
  listPersistedMobileWorkspaces,
  resolveDefaultMobileWorkspacePath,
  type listPersistedMobileWorkspaces as ListMobileWorkspacesFn,
} from './persisted-state'
import { isManagedWorktreePath, registerMobileWorkspaceForPath } from './mobile-workspace-registry'
import { mapModelPresetsToCodexItems } from './mobile-rpc-adapter'
import type { MobileFocusSessionPayload } from './mobile-focus-session'
import { MobileDebugTimer, mobileDebugLog, mobileDebugWarn } from './mobile-debug-log'

export interface MobileRouterDeps {
  readonly agentChatHost: AgentChatHost
  readonly gitService: typeof GitServiceType
  readonly annotationService: typeof AnnotationServiceType
  readonly listMobileWorkspaces: typeof ListMobileWorkspacesFn
  readonly onSessionStarted?: (payload: MobileFocusSessionPayload) => void
  readonly onSessionSubmitFailed?: (payload: { sessionId: string; error: string }) => void
}

export interface MobileRouter {
  /** Parses + dispatches a raw JSON-RPC request string, returns the response. */
  handleApplicationMessage(payloadText: string): Promise<MobileRpcResponse | null>
  /** Direct method invocation, for tests + future internal callers. */
  dispatch(request: MobileRpcRequest): Promise<MobileRpcResponse>
}

const MAX_WORKSPACE_READ_BYTES = 256 * 1024

export function createMobileMethodRouter(deps: MobileRouterDeps): MobileRouter {
  async function dispatch(request: MobileRpcRequest): Promise<MobileRpcResponse> {
    try {
      const result = await runMethod(request.method, request.params, deps)
      return { kind: 'rpcResponse', id: request.id, result }
    } catch (error) {
      const normalized = normalizeError(error)
      return {
        kind: 'rpcResponse',
        id: request.id,
        error: normalized,
      }
    }
  }

  async function handleApplicationMessage(payloadText: string): Promise<MobileRpcResponse | null> {
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(payloadText)
    } catch {
      return makeProtocolError('parse_error', 'The bridge could not parse the JSON-RPC payload.')
    }
    // Tolerate non-request messages (e.g. responses to bridge-initiated calls in
    // the future) by returning null — the caller drops them without replying.
    if (
      !parsedJson
      || typeof parsedJson !== 'object'
      || ((parsedJson as { kind?: unknown }).kind !== 'rpcRequest'
        && (typeof (parsedJson as { id?: unknown }).id !== 'string'
          || typeof (parsedJson as { method?: unknown }).method !== 'string'))
    ) {
      return null
    }
    const normalizedRequest = (parsedJson as { kind?: unknown }).kind === 'rpcRequest'
      ? parsedJson
      : {
          kind: 'rpcRequest',
          id: (parsedJson as { id?: unknown }).id,
          method: (parsedJson as { method?: unknown }).method,
          params: (parsedJson as { params?: unknown }).params ?? {},
        }
    const parsed = mobileRpcRequestSchema.safeParse(normalizedRequest)
    if (!parsed.success) {
      const id = typeof (parsedJson as { id?: unknown }).id === 'string'
        ? ((parsedJson as { id?: unknown }).id as string)
        : 'unknown'
      return {
        kind: 'rpcResponse',
        id,
        error: {
          code: 'invalid_request',
          message: 'The JSON-RPC request shape was rejected by the bridge.',
          data: parsed.error.flatten(),
        },
      }
    }
    return dispatch(parsed.data)
  }

  return { dispatch, handleApplicationMessage }
}

async function runMethod(
  method: MobileRpcMethod,
  params: Record<string, unknown>,
  deps: MobileRouterDeps,
): Promise<unknown> {
  switch (method) {
    case 'workspace.list':
      return { workspaces: deps.listMobileWorkspaces() }

    case 'workspace.read':
      return readWorkspaceFile(parse(workspaceReadParamsSchema, params))

    case 'model.list': {
      const p = parse(modelListParamsSchema, params)
      const workspacePath = p.workspacePath?.trim()
        || deps.listMobileWorkspaces().find((ws) => ws.worktreePath)?.worktreePath
        || resolveDefaultMobileWorkspacePath()
      if (!workspacePath) {
        return { items: [] }
      }
      try {
        const presets = await deps.agentChatHost.listPiModels(workspacePath)
        return { items: mapModelPresetsToCodexItems(presets) }
      } catch (error) {
        console.warn('[mobile] model.list failed for workspace', workspacePath, error)
        return { items: [] }
      }
    }

    case 'session.list': {
      if (params.listAll === true) {
        const workspaceIds = Array.isArray(params.workspaceIds)
          ? params.workspaceIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          : deps.listMobileWorkspaces().map((ws) => ws.id)
        const sessions: AgentChatSessionState[] = []
        for (const workspaceId of workspaceIds) {
          sessions.push(...await deps.agentChatHost.listSessions(workspaceId))
        }
        return { sessions }
      }
      const p = parse(sessionListParamsSchema, params)
      const sessions = await deps.agentChatHost.listSessions(p.workspaceId)
      return { sessions }
    }

    case 'session.start': {
      const p = parse(sessionStartParamsSchema, params)
      if (isManagedWorktreePath(p.workspacePath)) {
        await registerMobileWorkspaceForPath({
          worktreePath: p.workspacePath,
          notifyRenderer: true,
        }).catch((error) => {
          console.warn('[mobile] failed to register managed worktree workspace', error)
        })
      }
      const state = await deps.agentChatHost.createSession({
        workspaceId: p.workspaceId,
        workspacePath: p.workspacePath,
        provider: p.provider,
        model: p.model,
        title: p.title,
        plan: p.plan,
      })
      deps.onSessionStarted?.({
        sessionId: state.sessionId,
        workspaceId: state.workspaceId,
        workspacePath: state.workspacePath,
        title: state.title,
      })
      return { session: state }
    }

    case 'session.resume': {
      const p = parse(sessionResumeParamsSchema, params)
      const session = await deps.agentChatHost.getSession(p.sessionId)
      if (!session) throw new RpcError('session_not_found', `Unknown session: ${p.sessionId}`)
      return {
        session: session.state,
        ...(p.excludeTurns ? {} : { transcript: session.transcript }),
      }
    }

    case 'session.reply': {
      const p = parse(sessionReplyParamsSchema, params)
      const session = await deps.agentChatHost.getSession(p.sessionId)
      if (!session) {
        throw new RpcError('session_not_found', `Unknown session: ${p.sessionId}`)
      }
      if (session.state.runPhase === 'awaitingUser') {
        throw new RpcError(
          'awaiting_user',
          'The session is waiting for user input before another turn can start.',
        )
      }
      const submitTimer = new MobileDebugTimer('router', 'session.reply.submit', {
        sessionId: p.sessionId,
        textChars: p.text.length,
        deliverAs: p.deliverAs ?? null,
        runPhase: session.state.runPhase,
        status: session.state.status,
      })
      mobileDebugLog('router', 'session.reply accepted (returning before submit settles)', {
        sessionId: p.sessionId,
        textChars: p.text.length,
      })
      void deps.agentChatHost.submit(p.sessionId, p.text, p.deliverAs)
        .then(() => {
          submitTimer.finish({ outcome: 'ok' })
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          submitTimer.fail(error, { outcome: 'failed' })
          console.warn('[mobile-method-router] session.reply submit failed', message)
          mobileDebugWarn('router', 'session.reply async submit failed', {
            sessionId: p.sessionId,
            error: message,
          })
          deps.onSessionSubmitFailed?.({ sessionId: p.sessionId, error: message })
        })
      return { ok: true }
    }

    case 'session.cancel': {
      const p = parse(sessionCancelParamsSchema, params)
      await deps.agentChatHost.cancel(p.sessionId)
      return { ok: true }
    }

    case 'session.history': {
      const p = parse(sessionHistoryParamsSchema, params)
      const session = await deps.agentChatHost.getSession(p.sessionId)
      if (!session) throw new RpcError('session_not_found', `Unknown session: ${p.sessionId}`)
      return { state: session.state, transcript: session.transcript }
    }

    case 'session.set_plan': {
      const p = parse(sessionSetPlanParamsSchema, params)
      await deps.agentChatHost.setPlan(p.sessionId, p.plan)
      return { ok: true }
    }

    case 'plan.approve': {
      const p = parse(planDecisionParamsSchema, params)
      const text = p.text?.trim() || APPROVE_PLAN_MESSAGE
      await deps.agentChatHost.submit(p.sessionId, text)
      return { ok: true }
    }

    case 'plan.reject': {
      const p = parse(planDecisionParamsSchema, params)
      // No semantic difference at the host level — the user sends a rejection
      // message; the model handles it. We just submit the text the phone gave us.
      const text = p.text?.trim() || 'Rejecting plan. Please revise the plan instead of implementing.'
      await deps.agentChatHost.submit(p.sessionId, text)
      return { ok: true }
    }

    case 'git.status': {
      const p = parse(gitWorktreeParamsSchema, params)
      const status = await deps.gitService.getStatus(p.worktreePath)
      const branch = await deps.gitService.getCurrentBranch(p.worktreePath).catch(() => '')
      return { branch, status }
    }

    case 'git.branch.list': {
      const p = parse(gitWorktreeParamsSchema, params)
      const branches = await deps.gitService.getBranches(p.worktreePath)
      return { branches }
    }

    case 'git.branch.switch': {
      const p = parse(gitBranchSwitchParamsSchema, params)
      await deps.gitService.checkoutBranch(p.worktreePath, p.branch)
      return { ok: true }
    }

    case 'git.commit': {
      const p = parse(gitCommitParamsSchema, params)
      await deps.gitService.commit(p.worktreePath, p.message)
      return { ok: true }
    }

    case 'git.diff': {
      const p = parse(gitDiffParamsSchema, params)
      if (p.filePath) {
        const diff = await deps.gitService.getFileDiff(p.worktreePath, p.filePath)
        return { diff }
      }
      const diff = await deps.gitService.getDiff(p.worktreePath, p.staged ?? false)
      return { diff }
    }

    case 'annotation.list': {
      const p = parse(annotationListParamsSchema, params)
      const annotations = await deps.annotationService.listComments(p.worktreePath, p.file)
      return { annotations }
    }

    case 'annotation.create': {
      const p = parse(annotationCreateParamsSchema, params)
      await deps.annotationService.addComment(
        p.worktreePath,
        p.file,
        p.newLine,
        p.summary,
        {
          rationale: p.rationale,
          author: p.author,
          force: p.force,
          lineEnd: p.lineEnd,
          workspaceId: p.workspaceId,
        },
      )
      return { ok: true }
    }

    case 'annotation.resolve': {
      const p = parse(annotationResolveParamsSchema, params)
      await deps.annotationService.setResolved(p.worktreePath, p.commentId, p.resolved)
      return { ok: true }
    }

    default: {
      const _exhaustive: never = method
      throw new RpcError('method_not_found', `Unsupported method: ${String(_exhaustive)}`)
    }
  }
}

async function readWorkspaceFile(params: {
  workspacePath: string
  relativePath: string
  maxBytes?: number
}): Promise<{ relativePath: string; contents: string; truncated: boolean; size: number }> {
  const absolute = resolveWithinWorkspace(params.workspacePath, params.relativePath)
  const limit = Math.min(params.maxBytes ?? MAX_WORKSPACE_READ_BYTES, MAX_WORKSPACE_READ_BYTES)
  const info = await stat(absolute).catch(() => null)
  if (!info || !info.isFile()) {
    throw new RpcError('not_found', `No such file: ${params.relativePath}`)
  }
  const buffer = await readFile(absolute)
  const truncated = buffer.byteLength > limit
  const sliced = truncated ? buffer.subarray(0, limit) : buffer
  return {
    relativePath: params.relativePath,
    contents: sliced.toString('utf8'),
    truncated,
    size: info.size,
  }
}

function resolveWithinWorkspace(workspacePath: string, relativePath: string): string {
  // Guard against path traversal. Both inputs are normalized; the final absolute
  // path must remain inside the workspace root the renderer already approved.
  const root = resolvePath(workspacePath)
  const candidate = resolvePath(join(root, relativePath))
  if (candidate !== root && !candidate.startsWith(`${root}/`)) {
    throw new RpcError('path_outside_workspace', 'Refusing to read outside the workspace root.')
  }
  return candidate
}

function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new RpcError('invalid_params', 'The method parameters failed validation.', parsed.error.flatten())
  }
  return parsed.data
}

class RpcError extends Error {
  readonly code: string
  readonly data?: unknown
  constructor(code: string, message: string, data?: unknown) {
    super(message)
    this.code = code
    this.data = data
  }
}

function normalizeError(error: unknown): MobileRpcResponse['error'] {
  if (error instanceof RpcError) {
    return error.data === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, data: error.data }
  }
  if (error instanceof Error) {
    return { code: 'internal_error', message: error.message }
  }
  return { code: 'internal_error', message: 'Unknown bridge error.' }
}

function makeProtocolError(code: string, message: string): MobileRpcResponse {
  return { kind: 'rpcResponse', id: 'unknown', error: { code, message } }
}

export const __testing = {
  RpcError,
  normalizeError,
  resolveWithinWorkspace,
}
