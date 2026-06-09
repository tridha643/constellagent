import type { SessionRef } from "./types.js";

/** Stable cache key for a session within a workspace. */
export function sessionKey(sessionRef: SessionRef): string {
  return `${sessionRef.workspaceId}:${sessionRef.sessionId}`;
}
