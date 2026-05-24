import { z } from 'zod';
export const isoDateTimeSchema = z.string().datetime({ offset: true });
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
});
export const mobileWorkspaceSummarySchema = z.object({
    id: z.string(),
    projectId: z.string().optional(),
    name: z.string(),
    branch: z.string().optional(),
    worktreePath: z.string().optional(),
    updatedAt: isoDateTimeSchema,
});
export const mobileSessionSummarySchema = z.object({
    id: z.string(),
    workspaceId: z.string(),
    title: z.string(),
    status: z.enum(['idle', 'running', 'failed']),
    updatedAt: isoDateTimeSchema,
});
export const mobilePlanSummarySchema = z.object({
    id: z.string(),
    workspaceId: z.string().optional(),
    title: z.string(),
    status: z.enum(['open', 'approved', 'rejected', 'implemented']),
    updatedAt: isoDateTimeSchema,
});
export const mobileCommandTypeSchema = z.enum([
    'session.reply',
    'session.cancel',
    'plan.approve',
    'plan.reject',
    'annotation.create',
    'annotation.resolve',
]);
export const mobileCommandStatusSchema = z.enum([
    'pending',
    'running',
    'completed',
    'failed',
    'rejected',
]);
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
});
export const createMobileCommandRequestSchema = z.object({
    type: mobileCommandTypeSchema,
    payload: z.record(z.string(), z.unknown()).default({}),
});
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
]);
export const mobileEventSchema = z.object({
    id: z.number().int().nonnegative(),
    type: mobileEventTypeSchema,
    workspaceId: z.string().optional(),
    sessionId: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).default({}),
    createdAt: isoDateTimeSchema,
});
export const mobileDeviceSchema = z.object({
    id: z.string(),
    name: z.string(),
    createdAt: isoDateTimeSchema,
    lastSeenAt: isoDateTimeSchema.optional(),
    revokedAt: isoDateTimeSchema.optional(),
});
export const mobileApiErrorSchema = z.object({
    error: z.string(),
    code: z.string().optional(),
});
export const mobileEventsResponseSchema = z.object({
    events: z.array(mobileEventSchema),
});
export const mobileWorkspacesResponseSchema = z.object({
    workspaces: z.array(mobileWorkspaceSummarySchema),
});
export const mobileCommandResponseSchema = z.object({
    command: mobileCommandSchema,
});
//# sourceMappingURL=index.js.map