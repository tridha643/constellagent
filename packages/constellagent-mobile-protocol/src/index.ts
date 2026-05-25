import { z } from 'zod'

export const isoDateTimeSchema = z.string().datetime({ offset: true })

export const mobileAccessStatusSchema = z.object({
  enabled: z.boolean(),
  running: z.boolean(),
  host: z.string(),
  port: z.number().int().min(0).max(65535),
  baseUrl: z.string(),
  tailscale: z.object({
    available: z.boolean(),
    hostName: z.string().optional(),
    addresses: z.array(z.string()),
  }),
})
export type MobileAccessStatus = z.infer<typeof mobileAccessStatusSchema>

export const mobileWorkspaceSummarySchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  name: z.string(),
  branch: z.string().optional(),
  worktreePath: z.string().optional(),
  updatedAt: isoDateTimeSchema,
})
export type MobileWorkspaceSummary = z.infer<typeof mobileWorkspaceSummarySchema>

export const mobileSessionSummarySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  status: z.enum(['idle', 'running', 'failed']),
  updatedAt: isoDateTimeSchema,
})
export type MobileSessionSummary = z.infer<typeof mobileSessionSummarySchema>

export const mobilePlanSummarySchema = z.object({
  id: z.string(),
  workspaceId: z.string().optional(),
  title: z.string(),
  status: z.enum(['open', 'approved', 'rejected', 'implemented']),
  updatedAt: isoDateTimeSchema,
})
export type MobilePlanSummary = z.infer<typeof mobilePlanSummarySchema>

export const mobileCommandTypeSchema = z.enum([
  'session.reply',
  'session.cancel',
  'plan.approve',
  'plan.reject',
  'annotation.create',
  'annotation.resolve',
])
export type MobileCommandType = z.infer<typeof mobileCommandTypeSchema>

export const mobileCommandStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'rejected',
])
export type MobileCommandStatus = z.infer<typeof mobileCommandStatusSchema>

export const mobileCommandSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  type: mobileCommandTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  status: mobileCommandStatusSchema,
  policyResult: z.enum(['allowed', 'confirmation_required', 'blocked']),
  createdAt: isoDateTimeSchema,
  claimedAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  error: z.string().optional(),
})
export type MobileCommand = z.infer<typeof mobileCommandSchema>

export const createMobileCommandRequestSchema = z.object({
  type: mobileCommandTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
})
export type CreateMobileCommandRequest = z.infer<typeof createMobileCommandRequestSchema>

export const mobileEventTypeSchema = z.enum([
  'workspace.updated',
  'session.started',
  'session.message.delta',
  'session.message.completed',
  'session.tool.started',
  'session.tool.completed',
  'session.needs_input',
  'plan.created',
  'plan.approved',
  'plan.rejected',
  'changes.updated',
  'annotation.created',
  'command.completed',
  'command.rejected',
])
export type MobileEventType = z.infer<typeof mobileEventTypeSchema>

export const mobileEventSchema = z.object({
  id: z.number().int().nonnegative(),
  type: mobileEventTypeSchema,
  workspaceId: z.string().optional(),
  sessionId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: isoDateTimeSchema,
})
export type MobileEvent = z.infer<typeof mobileEventSchema>

export const mobileDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema.optional(),
  revokedAt: isoDateTimeSchema.optional(),
})
export type MobileDevice = z.infer<typeof mobileDeviceSchema>

export const mobileApiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
})
export type MobileApiError = z.infer<typeof mobileApiErrorSchema>

export const mobileEventsResponseSchema = z.object({
  events: z.array(mobileEventSchema),
})
export type MobileEventsResponse = z.infer<typeof mobileEventsResponseSchema>

export const mobileWorkspacesResponseSchema = z.object({
  workspaces: z.array(mobileWorkspaceSummarySchema),
})
export type MobileWorkspacesResponse = z.infer<typeof mobileWorkspacesResponseSchema>

export const mobileCommandResponseSchema = z.object({
  command: mobileCommandSchema,
})
export type MobileCommandResponse = z.infer<typeof mobileCommandResponseSchema>

// ---------------------------------------------------------------------------
// E2EE secure-transport wire frames (mirrors phodex-bridge secure-transport.js)
// ---------------------------------------------------------------------------

export const PAIRING_QR_VERSION = 2 as const
export const SECURE_PROTOCOL_VERSION = 1 as const
export const HANDSHAKE_TAG = 'constellagent-e2ee-v1' as const

export const handshakeModeSchema = z.enum(['qr_bootstrap', 'trusted_reconnect'])
export type HandshakeMode = z.infer<typeof handshakeModeSchema>

export const secureSenderSchema = z.enum(['mac', 'iphone'])
export type SecureSender = z.infer<typeof secureSenderSchema>

const base64Schema = z.string().min(1)

export const clientHelloSchema = z.object({
  kind: z.literal('clientHello'),
  protocolVersion: z.number().int(),
  sessionId: z.string(),
  handshakeMode: handshakeModeSchema,
  phoneDeviceId: z.string(),
  phoneIdentityPublicKey: base64Schema,
  phoneEphemeralPublicKey: base64Schema,
  clientNonce: base64Schema,
  displayName: z.string().optional(),
  appVersion: z.string().optional(),
})
export type ClientHello = z.infer<typeof clientHelloSchema>

export const serverHelloSchema = z.object({
  kind: z.literal('serverHello'),
  protocolVersion: z.number().int(),
  sessionId: z.string(),
  handshakeMode: handshakeModeSchema,
  macDeviceId: z.string(),
  macIdentityPublicKey: base64Schema,
  macEphemeralPublicKey: base64Schema,
  serverNonce: base64Schema,
  keyEpoch: z.number().int().positive(),
  expiresAtForTranscript: z.number().int().nonnegative(),
  macSignature: base64Schema,
  clientNonce: base64Schema,
  displayName: z.string().default(''),
})
export type ServerHello = z.infer<typeof serverHelloSchema>

export const clientAuthSchema = z.object({
  kind: z.literal('clientAuth'),
  sessionId: z.string(),
  phoneDeviceId: z.string(),
  keyEpoch: z.number().int().positive(),
  phoneSignature: base64Schema,
})
export type ClientAuth = z.infer<typeof clientAuthSchema>

export const secureReadySchema = z.object({
  kind: z.literal('secureReady'),
  sessionId: z.string(),
  keyEpoch: z.number().int().positive(),
  macDeviceId: z.string(),
})
export type SecureReady = z.infer<typeof secureReadySchema>

export const resumeStateSchema = z.object({
  kind: z.literal('resumeState'),
  sessionId: z.string(),
  keyEpoch: z.number().int().positive(),
  lastAppliedBridgeOutboundSeq: z.number().int().nonnegative().default(0),
})
export type ResumeState = z.infer<typeof resumeStateSchema>

export const encryptedEnvelopeSchema = z.object({
  kind: z.literal('encryptedEnvelope'),
  v: z.number().int(),
  sessionId: z.string(),
  keyEpoch: z.number().int().positive(),
  sender: secureSenderSchema,
  counter: z.number().int().nonnegative(),
  ciphertext: base64Schema,
  tag: base64Schema,
})
export type EncryptedEnvelope = z.infer<typeof encryptedEnvelopeSchema>

export const secureErrorSchema = z.object({
  kind: z.literal('secureError'),
  code: z.string(),
  message: z.string(),
})
export type SecureError = z.infer<typeof secureErrorSchema>

export const pairingQrPayloadSchema = z.object({
  v: z.literal(PAIRING_QR_VERSION),
  relay: z.string(),
  sessionId: z.string(),
  macDeviceId: z.string(),
  macIdentityPublicKey: base64Schema,
  expiresAt: z.number().int().positive(),
  displayName: z.string().default(''),
})
export type PairingQrPayload = z.infer<typeof pairingQrPayloadSchema>

export const secureWireMessageSchema = z.discriminatedUnion('kind', [
  clientHelloSchema,
  serverHelloSchema,
  clientAuthSchema,
  secureReadySchema,
  resumeStateSchema,
  encryptedEnvelopeSchema,
  secureErrorSchema,
])
export type SecureWireMessage = z.infer<typeof secureWireMessageSchema>

// ---------------------------------------------------------------------------
// JSON-RPC method router (Phase 2). Mirrors the method names exposed by
// phodex-bridge's domain handlers but delegates to constellagent-native
// services. Wire format is a discriminated union on `kind`.
// ---------------------------------------------------------------------------

export const mobileRpcMethodSchema = z.enum([
  'workspace.list',
  'workspace.read',
  'model.list',
  'session.list',
  'session.start',
  'session.resume',
  'session.reply',
  'session.cancel',
  'session.history',
  'session.set_plan',
  'plan.approve',
  'plan.reject',
  'git.status',
  'git.branch.list',
  'git.branch.switch',
  'git.commit',
  'git.diff',
  'annotation.list',
  'annotation.create',
  'annotation.resolve',
])
export type MobileRpcMethod = z.infer<typeof mobileRpcMethodSchema>

export const mobileRpcRequestSchema = z.object({
  kind: z.literal('rpcRequest'),
  id: z.string().min(1),
  method: mobileRpcMethodSchema,
  params: z.record(z.string(), z.unknown()).default({}),
})
export type MobileRpcRequest = z.infer<typeof mobileRpcRequestSchema>

export const mobileRpcErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  data: z.unknown().optional(),
})
export type MobileRpcError = z.infer<typeof mobileRpcErrorSchema>

export const mobileRpcResponseSchema = z.object({
  kind: z.literal('rpcResponse'),
  id: z.string().min(1),
  result: z.unknown().optional(),
  error: mobileRpcErrorSchema.optional(),
})
export type MobileRpcResponse = z.infer<typeof mobileRpcResponseSchema>

export const mobileRpcEventEnvelopeSchema = z.object({
  kind: z.literal('rpcEvent'),
  event: mobileEventSchema,
})
export type MobileRpcEventEnvelope = z.infer<typeof mobileRpcEventEnvelopeSchema>

export const mobileApplicationMessageSchema = z.discriminatedUnion('kind', [
  mobileRpcRequestSchema,
  mobileRpcResponseSchema,
  mobileRpcEventEnvelopeSchema,
])
export type MobileApplicationMessage = z.infer<typeof mobileApplicationMessageSchema>

// Param shapes for the methods that take structured input. The router parses
// `request.params` against the relevant schema so handlers see typed payloads.

export const sessionListParamsSchema = z.object({
  workspaceId: z.string().min(1),
})
export type SessionListParams = z.infer<typeof sessionListParamsSchema>

export const sessionStartParamsSchema = z.object({
  workspaceId: z.string().min(1),
  workspacePath: z.string().min(1),
  provider: z.enum(['codex', 'cursor', 'pi']),
  model: z.string().min(1),
  title: z.string().optional(),
  plan: z.boolean().optional(),
})
export type SessionStartParams = z.infer<typeof sessionStartParamsSchema>

export const sessionResumeParamsSchema = z.object({
  sessionId: z.string().min(1),
  excludeTurns: z.boolean().optional(),
})
export type SessionResumeParams = z.infer<typeof sessionResumeParamsSchema>

export const sessionReplyParamsSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1),
  deliverAs: z.enum(['followUp', 'steer']).optional(),
})
export type SessionReplyParams = z.infer<typeof sessionReplyParamsSchema>

export const sessionCancelParamsSchema = z.object({
  sessionId: z.string().min(1),
})
export type SessionCancelParams = z.infer<typeof sessionCancelParamsSchema>

export const sessionHistoryParamsSchema = z.object({
  sessionId: z.string().min(1),
})
export type SessionHistoryParams = z.infer<typeof sessionHistoryParamsSchema>

export const sessionSetPlanParamsSchema = z.object({
  sessionId: z.string().min(1),
  plan: z.boolean(),
})
export type SessionSetPlanParams = z.infer<typeof sessionSetPlanParamsSchema>

export const workspaceReadParamsSchema = z.object({
  workspacePath: z.string().min(1),
  relativePath: z.string().min(1),
  maxBytes: z.number().int().positive().max(1_000_000).optional(),
})
export type WorkspaceReadParams = z.infer<typeof workspaceReadParamsSchema>

export const modelListParamsSchema = z.object({
  workspacePath: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
})
export type ModelListParams = z.infer<typeof modelListParamsSchema>

export const mobileModelOptionSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  supportsFastMode: z.boolean().optional(),
  supportedReasoningEfforts: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
  })).optional(),
  defaultReasoningEffort: z.string().optional(),
})
export type MobileModelOption = z.infer<typeof mobileModelOptionSchema>

export const modelListResponseSchema = z.object({
  items: z.array(mobileModelOptionSchema),
})
export type ModelListResponse = z.infer<typeof modelListResponseSchema>

export const gitWorktreeParamsSchema = z.object({
  worktreePath: z.string().min(1),
})
export type GitWorktreeParams = z.infer<typeof gitWorktreeParamsSchema>

export const gitDiffParamsSchema = z.object({
  worktreePath: z.string().min(1),
  staged: z.boolean().optional(),
  filePath: z.string().optional(),
})
export type GitDiffParams = z.infer<typeof gitDiffParamsSchema>

export const gitCommitParamsSchema = z.object({
  worktreePath: z.string().min(1),
  message: z.string().min(1),
})
export type GitCommitParams = z.infer<typeof gitCommitParamsSchema>

export const gitBranchSwitchParamsSchema = z.object({
  worktreePath: z.string().min(1),
  branch: z.string().min(1),
})
export type GitBranchSwitchParams = z.infer<typeof gitBranchSwitchParamsSchema>

export const annotationListParamsSchema = z.object({
  worktreePath: z.string().min(1),
  file: z.string().optional(),
})
export type AnnotationListParams = z.infer<typeof annotationListParamsSchema>

export const annotationCreateParamsSchema = z.object({
  worktreePath: z.string().min(1),
  file: z.string().min(1),
  newLine: z.number().int().positive(),
  summary: z.string().min(1),
  rationale: z.string().optional(),
  author: z.string().optional(),
  workspaceId: z.string().optional(),
  lineEnd: z.number().int().positive().optional(),
  force: z.boolean().optional(),
})
export type AnnotationCreateParams = z.infer<typeof annotationCreateParamsSchema>

export const annotationResolveParamsSchema = z.object({
  worktreePath: z.string().min(1),
  commentId: z.string().min(1),
  resolved: z.boolean().default(true),
})
export type AnnotationResolveParams = z.infer<typeof annotationResolveParamsSchema>

export const planDecisionParamsSchema = z.object({
  sessionId: z.string().min(1),
  /** Optional override of the auto-approval text the conductor sends back. */
  text: z.string().optional(),
})
export type PlanDecisionParams = z.infer<typeof planDecisionParamsSchema>
