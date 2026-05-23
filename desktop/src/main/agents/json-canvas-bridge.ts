import { randomUUID } from 'node:crypto'
import type { SessionRef } from '@pi-gui/session-driver'
import {
  normalizeCanvasOutput,
  parseRenderJsonCanvasFromText,
  RENDER_JSON_CANVAS_TOOL_NAME,
  type RenderJsonCanvasParams,
} from '../../shared/json-canvas-schema'
import { evToolFinished, evToolStarted, type AgentTurnContext } from './agent-driver'

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
