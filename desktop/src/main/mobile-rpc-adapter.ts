// Translates between the iOS client's codex-shaped JSON-RPC envelopes/params/responses
// and the constellagent bridge vocabulary handled by mobile-method-router.ts.

import type { AgentChatSessionState } from '../shared/agent-chat-types'
import {
  buildOptionMappings,
  type ConductorAskQuestionPrompt,
  type ConductorBlockingQuestion,
  type ConductorBlockingQuestionResponse,
} from '../shared/conductor-ask-question-types'
import type { TranscriptMessage } from '../shared/pi/pi-desktop-state'
import type { ModelPreset } from '../shared/plan-build-command'
import type { MobileEvent, MobileRpcRequest, MobileRpcResponse } from '@constellagent/mobile-protocol'
import {
  listPersistedMobileWorkspaces,
  resolveDefaultMobileWorkspacePath,
  resolveMobileWorkspaceForPath,
} from './persisted-state'
import { mobileDebugLog } from './mobile-debug-log'

export type MobileResponseShape =
  | 'model.list'
  | 'session.list'
  | 'session.start'
  | 'session.resume'
  | 'session.reply'
  | 'session.cancel'
  | 'session.history.read'
  | 'session.history.turns'
  | 'passthrough'

export interface ParsedInboundMobileRpc {
  readonly id: string
  readonly method: string
  readonly params: Record<string, unknown>
  readonly responseShape: MobileResponseShape
}

const BRIDGE_ERROR_CODE_TO_JSON_RPC: Record<string, number> = {
  parse_error: -32700,
  invalid_request: -32600,
  method_not_found: -32601,
  invalid_params: -32602,
  internal_error: -32603,
  session_not_found: -32001,
  not_found: -32002,
  path_outside_workspace: -32003,
}

/** Maps codex app-server method names to constellagent bridge methods (mirrors iOS ProtocolMapping). */
export function mapCodexMethodToBridge(method: string): string {
  switch (method) {
    case 'thread/list':
      return 'session.list'
    case 'thread/read':
    case 'thread/turns/list':
      return 'session.history'
    case 'thread/start':
      return 'session.start'
    case 'thread/resume':
      return 'session.resume'
    case 'turn/start':
      return 'session.reply'
    case 'turn/steer':
      return 'session.reply'
    case 'model/list':
      return 'model.list'
    case 'plan/set':
      return 'session.set_plan'
    case 'workspace/list':
      return 'workspace.list'
    case 'workspace/read':
      return 'workspace.read'
    case 'git/status':
      return 'git.status'
    case 'git/branch/list':
      return 'git.branch.list'
    case 'git/branch/switch':
      return 'git.branch.switch'
    case 'git/commit':
      return 'git.commit'
    case 'git/diff':
      return 'git.diff'
    case 'plan/approve':
      return 'plan.approve'
    case 'plan/reject':
      return 'plan.reject'
    case 'annotation/list':
      return 'annotation.list'
    case 'annotation/create':
      return 'annotation.create'
    case 'annotation/resolve':
      return 'annotation.resolve'
    default:
      return method
  }
}

export function parseInboundMobileRpc(payloadText: string): ParsedInboundMobileRpc | null {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(payloadText)
  } catch {
    return null
  }
  if (!parsedJson || typeof parsedJson !== 'object') return null
  const record = parsedJson as Record<string, unknown>
  if (record.kind === 'rpcResponse' || record.kind === 'rpcEvent') return null
  const id = typeof record.id === 'string' ? record.id : null
  const method = typeof record.method === 'string' ? record.method : null
  if (!id || !method) return null
  const params = record.params && typeof record.params === 'object' && !Array.isArray(record.params)
    ? (record.params as Record<string, unknown>)
    : {}
  const bridgeMethod = mapCodexMethodToBridge(method)
  const bridgeParams = method === 'turn/steer' && params.deliverAs == null
    ? { ...params, deliverAs: 'steer' }
    : params
  const parsed: ParsedInboundMobileRpc = {
    id,
    method: bridgeMethod,
    params: bridgeParams,
    responseShape: inferResponseShape(bridgeMethod, bridgeParams),
  }
  if (method === 'turn/start' || method === 'turn/steer' || bridgeMethod === 'session.reply') {
    mobileDebugLog('rpc-adapter', `adapt inbound ${method} → ${bridgeMethod}`, {
      requestId: id,
      threadId: typeof params.threadId === 'string' ? params.threadId : null,
      sessionId: typeof params.sessionId === 'string' ? params.sessionId : null,
      inputItems: Array.isArray(params.input) ? params.input.length : null,
      textChars: extractTurnStartTextPreview(params).length,
    })
  }
  return parsed
}

function extractTurnStartTextPreview(params: Record<string, unknown>): string {
  if (typeof params.text === 'string') return params.text
  if (!Array.isArray(params.input)) return ''
  for (const item of params.input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record.text === 'string') return record.text
    if (typeof record.content === 'string') return record.content
  }
  return ''
}

export function adaptInboundRequest(inbound: ParsedInboundMobileRpc): MobileRpcRequest {
  const coerced = coerceResumeInsteadOfStart(inbound)
  const params = adaptInboundParams(coerced.method, coerced.params)
  return {
    kind: 'rpcRequest',
    id: coerced.id,
    method: coerced.method as MobileRpcRequest['method'],
    params,
  }
}

export function adaptInboundParams(method: string, params: Record<string, unknown>): Record<string, unknown> {
  switch (method) {
    case 'model.list':
      return adaptModelListParams(params)
    case 'session.list':
      return adaptSessionListParams(params)
    case 'session.start':
      return adaptSessionStartParams(params)
    case 'session.resume':
      return adaptSessionResumeParams(params)
    case 'session.reply':
      return adaptSessionReplyParams(params)
    case 'session.cancel':
      return adaptSessionCancelParams(params)
    case 'session.history':
      return adaptSessionHistoryParams(params)
    case 'session.set_plan':
      return adaptSessionSetPlanParams(params)
    default:
      return params
  }
}

export function adaptOutboundResponse(
  inbound: ParsedInboundMobileRpc,
  response: MobileRpcResponse,
): Record<string, unknown> {
  // The phone resolves pending requests strictly by its original JSON-RPC id.
  // Always echo that id even if an internal router/schema error produced a
  // different response id, otherwise the iOS continuation is left pending and
  // later sync traffic looks like duplicated/mangled messages.
  const responseId = inbound.id
  if (response.error) {
    const bridgeCode = response.error.code
    const jsonRpcCode = BRIDGE_ERROR_CODE_TO_JSON_RPC[bridgeCode] ?? -32000
    const data = mergeErrorData(response.error.data, bridgeCode)
    return {
      id: responseId,
      error: {
        code: jsonRpcCode,
        message: response.error.message,
        ...(data === undefined ? {} : { data }),
      },
    }
  }
  const result = adaptOutboundResult(inbound.responseShape, response.result, inbound.params)
  return { id: responseId, result }
}

/** Synthetic turn id shared with adaptSessionReplyResult — iOS keys streaming UI off this value. */
function mobileSyntheticTurnId(sessionId: string): string {
  return `${sessionId}-turn`
}

export function adaptOutboundEvent(event: MobileEvent): Record<string, unknown> | null {
  switch (event.type) {
    case 'session.message.delta': {
      const text = stringField(event.payload.text) ?? ''
      const messageId = stringField(event.payload.messageId)
      const sessionId = event.sessionId
      if (!sessionId || !text) return null
      return {
        method: 'item/agentMessage/delta',
        params: {
          threadId: sessionId,
          turnId: mobileSyntheticTurnId(sessionId),
          itemId: messageId ?? `${sessionId}-assistant`,
          delta: text,
          constellagentDesktopMirror: true,
        },
      }
    }
    case 'session.message.completed':
    case 'session.started': {
      const sessionId = event.sessionId
      if (!sessionId) return null
      const status = stringField(event.payload.status)
      const errorMessage = stringField(event.payload.error)
      const isFailed = status === 'failed'
      return {
        method: event.type === 'session.started' ? 'turn/started' : 'turn/completed',
        params: {
          threadId: sessionId,
          turnId: mobileSyntheticTurnId(sessionId),
          ...(status ? { status } : {}),
          ...(isFailed && errorMessage
            ? {
                error: { message: errorMessage },
                errorMessage,
              }
            : {}),
          constellagentDesktopMirror: true,
        },
      }
    }
    case 'session.needs_input':
      return adaptBlockingQuestionEvent(event)
    default:
      return null
  }
}

export interface ParsedInboundMobileRpcResponse {
  readonly id: string
  readonly result?: unknown
  readonly error?: unknown
}

export function parseInboundMobileRpcResponse(payloadText: string): ParsedInboundMobileRpcResponse | null {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(payloadText)
  } catch {
    return null
  }
  const record = objectRecord(parsedJson)
  if (!record) return null
  if (record.kind != null && record.kind !== 'rpcResponse') return null
  if (typeof record.method === 'string') return null
  const id = stringField(record.id)
  if (!id) return null
  if (!('result' in record) && !('error' in record)) return null
  return {
    id,
    ...(Object.prototype.hasOwnProperty.call(record, 'result') ? { result: record.result } : {}),
    ...(Object.prototype.hasOwnProperty.call(record, 'error') ? { error: record.error } : {}),
  }
}

function adaptBlockingQuestionEvent(event: MobileEvent): Record<string, unknown> | null {
  const sessionId = event.sessionId
  const requestId = stringField(event.payload.requestId)
  if (!sessionId || !requestId) return null
  const rawQuestions = Array.isArray(event.payload.questions) ? event.payload.questions : []
  const questions = rawQuestions
    .map((question, index) => adaptBlockingQuestionPromptForIos(question, requestId, index))
    .filter((question): question is Record<string, unknown> => question != null)
  if (!questions.length) return null
  const callId = stringField(event.payload.callId)
  return {
    id: requestId,
    method: 'item/tool/requestUserInput',
    params: {
      threadId: sessionId,
      turnId: mobileSyntheticTurnId(sessionId),
      itemId: callId ?? `request-${requestId}`,
      questions,
      constellagentDesktopMirror: true,
    },
  }
}

function adaptBlockingQuestionPromptForIos(
  rawQuestion: unknown,
  requestId: string,
  index: number,
): Record<string, unknown> | null {
  const question = objectRecord(rawQuestion)
  if (!question) return null
  const header = stringField(question.header) ?? 'Question'
  const prompt = stringField(question.question) ?? header
  const rawOptions = Array.isArray(question.options) ? question.options : []
  const options = rawOptions
    .map(adaptBlockingQuestionOptionForIos)
    .filter((option): option is Record<string, string> => option != null)
  const multiSelect = question.multiSelect === true
  return {
    id: mobileQuestionId(requestId, index),
    header,
    question: prompt,
    selectionLimit: multiSelect ? Math.max(options.length, 1) : 1,
    options,
  }
}

function adaptBlockingQuestionOptionForIos(rawOption: unknown): Record<string, string> | null {
  const option = objectRecord(rawOption)
  if (!option) return null
  const label = stringField(option.label)
  if (!label) return null
  return {
    label,
    description: typeof option.description === 'string' ? option.description : '',
  }
}

function mobileQuestionId(requestId: string, index: number): string {
  return `${requestId}-q${index + 1}`
}

export function adaptStructuredUserInputResponse(
  response: ParsedInboundMobileRpcResponse,
  question: ConductorBlockingQuestion,
): ConductorBlockingQuestionResponse['details'] {
  if (response.error) {
    return { cancelled: true, answers: [] }
  }
  const answerMap = extractStructuredUserInputAnswerMap(response.result)
  return {
    cancelled: false,
    answers: question.questions.map((prompt, index) => {
      const rawAnswers = extractStructuredAnswerStrings(answerMap[mobileQuestionId(question.requestId, index)])
      return adaptStructuredAnswer(prompt, rawAnswers)
    }),
  }
}

function extractStructuredUserInputAnswerMap(result: unknown): Record<string, unknown> {
  const resultObject = objectRecord(result)
  const answersObject = objectRecord(resultObject?.answers)
  return answersObject ?? {}
}

function extractStructuredAnswerStrings(value: unknown): string[] {
  const answerObject = objectRecord(value)
  const rawAnswers = Array.isArray(answerObject?.answers)
    ? answerObject.answers
    : Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? [value]
        : []
  return rawAnswers
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function adaptStructuredAnswer(
  prompt: ConductorAskQuestionPrompt,
  rawAnswers: readonly string[],
): ConductorBlockingQuestionResponse['details']['answers'][number] {
  const optionLabels = new Set(prompt.options.map((option) => option.label))
  const selectedOptions = rawAnswers.filter((answer) => optionLabels.has(answer))
  const hasCustomAnswer = rawAnswers.some((answer) => !optionLabels.has(answer))
  const optionMappings = prompt.options.length ? buildOptionMappings(prompt.options) : undefined
  return {
    header: prompt.header,
    question: prompt.question,
    answer: prompt.multiSelect ? [...rawAnswers] : (rawAnswers[0] ?? ''),
    wasCustom: hasCustomAnswer,
    selectedOptions,
    ...(optionMappings ? { optionMappings } : {}),
    ...(rawAnswers.length ? { details: rawAnswers.join('\n') } : {}),
  }
}

function inferResponseShape(method: string, params: Record<string, unknown>): MobileResponseShape {
  if (method === 'model.list') return 'model.list'
  if (method === 'session.list') return 'session.list'
  if (method === 'session.start') return 'session.start'
  if (method === 'session.resume') return 'session.resume'
  if (method === 'session.reply') return 'session.reply'
  if (method === 'session.cancel') return 'session.cancel'
  if (method === 'session.history') {
    if (params.limit != null || params.cursor != null) return 'session.history.turns'
    return 'session.history.read'
  }
  return 'passthrough'
}

function adaptModelListParams(params: Record<string, unknown>): Record<string, unknown> {
  const workspacePath = stringField(params.workspacePath)
    ?? stringField(params.cwd)
    ?? resolveDefaultMobileWorkspacePath()
  if (!workspacePath) return params
  return { ...params, workspacePath }
}

function adaptSessionListParams(params: Record<string, unknown>): Record<string, unknown> {
  const workspaceId = stringField(params.workspaceId)
  if (workspaceId) return { workspaceId }
  const workspaces = listPersistedMobileWorkspaces()
  if (workspaces.length === 1) return { workspaceId: workspaces[0]!.id }
  return { listAll: true, ...(workspaces.length ? { workspaceIds: workspaces.map((ws) => ws.id) } : {}) }
}

function adaptSessionResumeParams(params: Record<string, unknown>): Record<string, unknown> {
  const sessionId = stringField(params.sessionId) ?? stringField(params.threadId)
  if (!sessionId) return params
  const adapted: Record<string, unknown> = { sessionId }
  if (typeof params.excludeTurns === 'boolean') adapted.excludeTurns = params.excludeTurns
  return adapted
}

function coerceResumeInsteadOfStart(inbound: ParsedInboundMobileRpc): ParsedInboundMobileRpc {
  if (inbound.method !== 'session.start') return inbound
  const sessionId = stringField(inbound.params.threadId) ?? stringField(inbound.params.sessionId)
  if (!sessionId) return inbound
  return {
    ...inbound,
    method: 'session.resume',
    responseShape: 'session.resume',
  }
}

function adaptSessionStartParams(params: Record<string, unknown>): Record<string, unknown> {
  const cwd = stringField(params.cwd) ?? stringField(params.workspacePath)
  const model = stringField(params.model)
  if (!cwd || !model) {
    const workspacePath = cwd ?? resolveDefaultMobileWorkspacePath() ?? process.cwd()
    const resolved = cwd ? resolveMobileWorkspaceForPath(cwd) : null
    return {
      workspaceId: stringField(params.workspaceId) ?? resolved?.workspaceId ?? 'mobile-unknown',
      workspacePath: resolved?.workspacePath ?? workspacePath,
      provider: stringField(params.provider) ?? 'pi',
      ...(model ? { model } : {}),
      ...(stringField(params.title) ? { title: stringField(params.title) } : {}),
      ...(typeof params.plan === 'boolean' ? { plan: params.plan } : {}),
    }
  }
  const resolved = resolveMobileWorkspaceForPath(cwd)
  return {
    workspaceId: stringField(params.workspaceId) ?? resolved.workspaceId,
    workspacePath: resolved.workspacePath,
    provider: stringField(params.provider) ?? 'pi',
    model,
    ...(stringField(params.title) ? { title: stringField(params.title) } : {}),
    ...(typeof params.plan === 'boolean' ? { plan: params.plan } : {}),
  }
}

function adaptSessionReplyParams(params: Record<string, unknown>): Record<string, unknown> {
  const sessionId = stringField(params.sessionId) ?? stringField(params.threadId)
  const text = stringField(params.text)
    ?? extractTurnInputText(params.input)
    ?? extractTurnInputText(params.message)
  const deliverAs = stringField(params.deliverAs)
    ?? (stringField(params.mode) === 'steer' ? 'steer' : undefined)
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(text ? { text } : {}),
    ...(deliverAs ? { deliverAs } : {}),
  }
}

function adaptSessionCancelParams(params: Record<string, unknown>): Record<string, unknown> {
  const sessionId = stringField(params.sessionId) ?? stringField(params.threadId)
  return sessionId ? { sessionId } : params
}

function adaptSessionHistoryParams(params: Record<string, unknown>): Record<string, unknown> {
  const sessionId = stringField(params.sessionId) ?? stringField(params.threadId)
  return sessionId ? { sessionId } : params
}

function adaptSessionSetPlanParams(params: Record<string, unknown>): Record<string, unknown> {
  const sessionId = stringField(params.sessionId) ?? stringField(params.threadId)
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(typeof params.plan === 'boolean' ? { plan: params.plan } : {}),
  }
}

function adaptOutboundResult(
  shape: MobileResponseShape,
  result: unknown,
  params: Record<string, unknown>,
): unknown {
  switch (shape) {
    case 'model.list':
      return adaptModelListResult(result)
    case 'session.list':
      return adaptSessionListResult(result)
    case 'session.start':
      return adaptSessionStartResult(result)
    case 'session.resume':
      return adaptSessionResumeResult(result, params)
    case 'session.reply':
      return adaptSessionReplyResult(result, params)
    case 'session.cancel':
      return { ok: true }
    case 'session.history.read':
      return adaptSessionHistoryReadResult(result)
    case 'session.history.turns':
      return adaptSessionHistoryTurnsResult(result)
    default:
      return result
  }
}

function adaptModelListResult(result: unknown): unknown {
  const items = (result as { items?: unknown })?.items
  if (Array.isArray(items)) return { items }
  return { items: [] }
}

function adaptSessionListResult(result: unknown): unknown {
  const sessions = (result as { sessions?: AgentChatSessionState[] })?.sessions ?? []
  return {
    data: sessions.map(sessionStateToThread),
    nextCursor: null,
  }
}

function adaptSessionStartResult(result: unknown): unknown {
  const session = (result as { session?: AgentChatSessionState })?.session
  if (!session) return result
  return { thread: sessionStateToThread(session) }
}

function adaptSessionResumeResult(result: unknown, params: Record<string, unknown>): unknown {
  const payload = result as { session?: AgentChatSessionState; transcript?: TranscriptMessage[] } | undefined
  if (!payload?.session) return result
  const thread = sessionStateToThread(payload.session)
  if (params.excludeTurns === true) {
    return { thread }
  }
  const transcript = payload.transcript ?? []
  return {
    thread: {
      ...thread,
      turns: transcriptToTurns(payload.session.sessionId, transcript),
    },
  }
}

function adaptSessionReplyResult(result: unknown, params: Record<string, unknown>): unknown {
  void result
  const threadId = stringField(params.threadId) ?? stringField(params.sessionId)
  const turnId = threadId ? `${threadId}-turn` : 'turn'
  return {
    turn: {
      id: turnId,
      threadId: threadId ?? '',
      status: 'running',
    },
  }
}

function adaptSessionHistoryReadResult(result: unknown): unknown {
  const payload = result as { state?: AgentChatSessionState; transcript?: TranscriptMessage[] } | undefined
  if (!payload?.state) return result
  return {
    thread: {
      ...sessionStateToThread(payload.state),
      turns: transcriptToTurns(payload.state.sessionId, payload.transcript ?? []),
    },
  }
}

function adaptSessionHistoryTurnsResult(result: unknown): unknown {
  const payload = result as { state?: AgentChatSessionState; transcript?: TranscriptMessage[] } | undefined
  if (!payload?.state) {
    return { data: [], nextCursor: null }
  }
  return {
    data: transcriptToTurns(payload.state.sessionId, payload.transcript ?? []),
    nextCursor: null,
  }
}

export function mapModelPresetsToCodexItems(presets: readonly ModelPreset[]): Array<Record<string, unknown>> {
  return presets.map((preset, index) => ({
    id: preset.cliModel,
    model: preset.cliModel,
    displayName: preset.label,
    description: preset.label,
    isDefault: index === 0,
    supportsFastMode: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
  }))
}

function sessionStateToThread(state: AgentChatSessionState): Record<string, unknown> {
  return {
    id: state.sessionId,
    title: state.title,
    name: state.title,
    cwd: state.workspacePath,
    model: state.model,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  }
}

function transcriptToTurns(sessionId: string, transcript: readonly TranscriptMessage[]): Array<Record<string, unknown>> {
  const turns: Array<Record<string, unknown>> = []
  let current: Record<string, unknown> | null = null
  for (const message of transcript) {
    if (message.kind !== 'message') continue
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (message.role === 'user') {
      if (current) turns.push(current)
      current = {
        id: message.id,
        threadId: sessionId,
        status: 'completed',
        items: [],
      }
    }
    if (!current) {
      current = {
        id: message.id,
        threadId: sessionId,
        status: 'completed',
        items: [],
      }
    }
    const items = Array.isArray(current.items) ? current.items as Array<Record<string, unknown>> : []
    items.push({
      id: message.id,
      type: message.role === 'user' ? 'userMessage' : 'agentMessage',
      ...(message.role === 'assistant' ? { text: message.text ?? '' } : { message: message.text ?? '' }),
    })
    current.items = items
  }
  if (current) turns.push(current)
  return turns
}

function extractTurnInputText(input: unknown): string | null {
  if (typeof input === 'string') return input.trim() || null
  if (!Array.isArray(input)) return null
  const parts: string[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.text === 'string' && record.text.trim()) parts.push(record.text.trim())
    else if (typeof record.content === 'string' && record.content.trim()) parts.push(record.content.trim())
  }
  return parts.length ? parts.join('\n') : null
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function mergeErrorData(data: unknown, bridgeCode: string): unknown {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return { ...(data as Record<string, unknown>), bridgeCode }
  }
  return { bridgeCode }
}

export const __testing = {
  adaptInboundParams,
  adaptInboundRequest,
  adaptOutboundResponse,
  adaptOutboundResult,
  adaptOutboundEvent,
  adaptStructuredUserInputResponse,
  coerceResumeInsteadOfStart,
  mapCodexMethodToBridge,
  mapModelPresetsToCodexItems,
  parseInboundMobileRpc,
  parseInboundMobileRpcResponse,
  sessionStateToThread,
}
