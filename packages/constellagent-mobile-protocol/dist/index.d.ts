import { z } from 'zod';
export declare const isoDateTimeSchema: z.ZodString;
export declare const mobileAccessStatusSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    running: z.ZodBoolean;
    host: z.ZodString;
    port: z.ZodNumber;
    baseUrl: z.ZodString;
    tailscale: z.ZodObject<{
        available: z.ZodBoolean;
        hostName: z.ZodOptional<z.ZodString>;
        addresses: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type MobileAccessStatus = z.infer<typeof mobileAccessStatusSchema>;
export declare const mobileWorkspaceSummarySchema: z.ZodObject<{
    id: z.ZodString;
    projectId: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    branch: z.ZodOptional<z.ZodString>;
    worktreePath: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type MobileWorkspaceSummary = z.infer<typeof mobileWorkspaceSummarySchema>;
export declare const mobileSessionSummarySchema: z.ZodObject<{
    id: z.ZodString;
    workspaceId: z.ZodString;
    title: z.ZodString;
    status: z.ZodEnum<{
        running: "running";
        idle: "idle";
        failed: "failed";
    }>;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type MobileSessionSummary = z.infer<typeof mobileSessionSummarySchema>;
export declare const mobilePlanSummarySchema: z.ZodObject<{
    id: z.ZodString;
    workspaceId: z.ZodOptional<z.ZodString>;
    title: z.ZodString;
    status: z.ZodEnum<{
        open: "open";
        approved: "approved";
        rejected: "rejected";
        implemented: "implemented";
    }>;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type MobilePlanSummary = z.infer<typeof mobilePlanSummarySchema>;
export declare const mobileCommandTypeSchema: z.ZodEnum<{
    "session.reply": "session.reply";
    "session.cancel": "session.cancel";
    "plan.approve": "plan.approve";
    "plan.reject": "plan.reject";
    "annotation.create": "annotation.create";
    "annotation.resolve": "annotation.resolve";
}>;
export type MobileCommandType = z.infer<typeof mobileCommandTypeSchema>;
export declare const mobileCommandStatusSchema: z.ZodEnum<{
    running: "running";
    failed: "failed";
    rejected: "rejected";
    pending: "pending";
    completed: "completed";
}>;
export type MobileCommandStatus = z.infer<typeof mobileCommandStatusSchema>;
export declare const mobileCommandSchema: z.ZodObject<{
    id: z.ZodString;
    deviceId: z.ZodString;
    type: z.ZodEnum<{
        "session.reply": "session.reply";
        "session.cancel": "session.cancel";
        "plan.approve": "plan.approve";
        "plan.reject": "plan.reject";
        "annotation.create": "annotation.create";
        "annotation.resolve": "annotation.resolve";
    }>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    status: z.ZodEnum<{
        running: "running";
        failed: "failed";
        rejected: "rejected";
        pending: "pending";
        completed: "completed";
    }>;
    policyResult: z.ZodEnum<{
        allowed: "allowed";
        confirmation_required: "confirmation_required";
        blocked: "blocked";
    }>;
    createdAt: z.ZodString;
    claimedAt: z.ZodOptional<z.ZodString>;
    completedAt: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type MobileCommand = z.infer<typeof mobileCommandSchema>;
export declare const createMobileCommandRequestSchema: z.ZodObject<{
    type: z.ZodEnum<{
        "session.reply": "session.reply";
        "session.cancel": "session.cancel";
        "plan.approve": "plan.approve";
        "plan.reject": "plan.reject";
        "annotation.create": "annotation.create";
        "annotation.resolve": "annotation.resolve";
    }>;
    payload: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type CreateMobileCommandRequest = z.infer<typeof createMobileCommandRequestSchema>;
export declare const mobileEventTypeSchema: z.ZodEnum<{
    "workspace.updated": "workspace.updated";
    "session.started": "session.started";
    "session.message.delta": "session.message.delta";
    "session.message.completed": "session.message.completed";
    "session.tool.started": "session.tool.started";
    "session.tool.completed": "session.tool.completed";
    "session.needs_input": "session.needs_input";
    "plan.created": "plan.created";
    "plan.approved": "plan.approved";
    "plan.rejected": "plan.rejected";
    "changes.updated": "changes.updated";
    "annotation.created": "annotation.created";
    "command.completed": "command.completed";
    "command.rejected": "command.rejected";
}>;
export type MobileEventType = z.infer<typeof mobileEventTypeSchema>;
export declare const mobileEventSchema: z.ZodObject<{
    id: z.ZodNumber;
    type: z.ZodEnum<{
        "workspace.updated": "workspace.updated";
        "session.started": "session.started";
        "session.message.delta": "session.message.delta";
        "session.message.completed": "session.message.completed";
        "session.tool.started": "session.tool.started";
        "session.tool.completed": "session.tool.completed";
        "session.needs_input": "session.needs_input";
        "plan.created": "plan.created";
        "plan.approved": "plan.approved";
        "plan.rejected": "plan.rejected";
        "changes.updated": "changes.updated";
        "annotation.created": "annotation.created";
        "command.completed": "command.completed";
        "command.rejected": "command.rejected";
    }>;
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    payload: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    createdAt: z.ZodString;
}, z.core.$strip>;
export type MobileEvent = z.infer<typeof mobileEventSchema>;
export declare const mobileDeviceSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    createdAt: z.ZodString;
    lastSeenAt: z.ZodOptional<z.ZodString>;
    revokedAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type MobileDevice = z.infer<typeof mobileDeviceSchema>;
export declare const mobileApiErrorSchema: z.ZodObject<{
    error: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type MobileApiError = z.infer<typeof mobileApiErrorSchema>;
export declare const mobileEventsResponseSchema: z.ZodObject<{
    events: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        type: z.ZodEnum<{
            "workspace.updated": "workspace.updated";
            "session.started": "session.started";
            "session.message.delta": "session.message.delta";
            "session.message.completed": "session.message.completed";
            "session.tool.started": "session.tool.started";
            "session.tool.completed": "session.tool.completed";
            "session.needs_input": "session.needs_input";
            "plan.created": "plan.created";
            "plan.approved": "plan.approved";
            "plan.rejected": "plan.rejected";
            "changes.updated": "changes.updated";
            "annotation.created": "annotation.created";
            "command.completed": "command.completed";
            "command.rejected": "command.rejected";
        }>;
        workspaceId: z.ZodOptional<z.ZodString>;
        sessionId: z.ZodOptional<z.ZodString>;
        payload: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        createdAt: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type MobileEventsResponse = z.infer<typeof mobileEventsResponseSchema>;
export declare const mobileWorkspacesResponseSchema: z.ZodObject<{
    workspaces: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        projectId: z.ZodOptional<z.ZodString>;
        name: z.ZodString;
        branch: z.ZodOptional<z.ZodString>;
        worktreePath: z.ZodOptional<z.ZodString>;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type MobileWorkspacesResponse = z.infer<typeof mobileWorkspacesResponseSchema>;
export declare const mobileCommandResponseSchema: z.ZodObject<{
    command: z.ZodObject<{
        id: z.ZodString;
        deviceId: z.ZodString;
        type: z.ZodEnum<{
            "session.reply": "session.reply";
            "session.cancel": "session.cancel";
            "plan.approve": "plan.approve";
            "plan.reject": "plan.reject";
            "annotation.create": "annotation.create";
            "annotation.resolve": "annotation.resolve";
        }>;
        payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        status: z.ZodEnum<{
            running: "running";
            failed: "failed";
            rejected: "rejected";
            pending: "pending";
            completed: "completed";
        }>;
        policyResult: z.ZodEnum<{
            allowed: "allowed";
            confirmation_required: "confirmation_required";
            blocked: "blocked";
        }>;
        createdAt: z.ZodString;
        claimedAt: z.ZodOptional<z.ZodString>;
        completedAt: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type MobileCommandResponse = z.infer<typeof mobileCommandResponseSchema>;
