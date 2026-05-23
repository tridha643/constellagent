import { randomUUID } from 'node:crypto'
import type { SessionRef } from '@pi-gui/session-driver'
import {
  normalizeCanvasOutput,
  parsePartialRenderJsonCanvasFromText,
  parseRenderJsonCanvasFromText,
  RENDER_JSON_CANVAS_TOOL_NAME,
  type RenderJsonCanvasParams,
} from '../../shared/json-canvas-schema'
import { evToolFinished, evToolStarted, evToolUpdated, type AgentTurnContext } from './agent-driver'

export interface SyntheticCanvasStreamState {
  started: boolean
}

export function emitSyntheticCanvasTool(
  ctx: AgentTurnContext,
  params: RenderJsonCanvasParams,
  callId?: string,
): string {
  const id = callId ?? `canvas-${randomUUID()}`
  ctx.emit(evToolStarted(ctx.sessionRef, id, RENDER_JSON_CANVAS_TOOL_NAME, params))
  ctx.emit(evToolFinished(ctx.sessionRef, id, true, params))
  return id
}

export function upsertSyntheticCanvasFromText(
  ctx: AgentTurnContext,
  text: string,
  callId: string,
  state: SyntheticCanvasStreamState,
): RenderJsonCanvasParams | null {
  const params = parsePartialRenderJsonCanvasFromText(text)
  if (!params) return null

  if (!state.started) {
    ctx.emit(evToolStarted(ctx.sessionRef, callId, RENDER_JSON_CANVAS_TOOL_NAME, params))
    state.started = true
  } else {
    ctx.emit(evToolUpdated(ctx.sessionRef, callId, undefined, params))
  }
  return params
}

export function finishSyntheticCanvasFromText(
  ctx: AgentTurnContext,
  text: string,
  callId: string,
  state: SyntheticCanvasStreamState,
): RenderJsonCanvasParams | null {
  const params =
    parseRenderJsonCanvasFromText(text) ?? parsePartialRenderJsonCanvasFromText(text)
  if (!params) return null

  if (!state.started) {
    ctx.emit(evToolStarted(ctx.sessionRef, callId, RENDER_JSON_CANVAS_TOOL_NAME, params))
    state.started = true
  }
  ctx.emit(evToolFinished(ctx.sessionRef, callId, true, params))
  return params
}

export function tryEmitSyntheticCanvasFromText(
  ctx: AgentTurnContext,
  text: string,
  callId?: string,
): RenderJsonCanvasParams | null {
  const params = parseRenderJsonCanvasFromText(text)
  if (!params) return null
  emitSyntheticCanvasTool(ctx, params, callId)
  return params
}

export function tryEmitSyntheticCanvasFromUnknown(
  ctx: AgentTurnContext,
  raw: unknown,
  callId?: string,
): RenderJsonCanvasParams | null {
  const params = normalizeCanvasOutput(raw)
  if (!params) return null
  emitSyntheticCanvasTool(ctx, params, callId)
  return params
}

export function syntheticCanvasCallId(sessionRef: SessionRef, turnKey: string): string {
  return `canvas:${sessionRef.sessionId}:${turnKey}`
}
