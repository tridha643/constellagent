import { describe, expect, it } from "bun:test";
import type { TranscriptMessage } from "@shared/pi/timeline-types";
import {
  latestToolCallIdAfterLastUser,
  transcriptWithSingleToolSlotAfterLastUser,
} from "./timeline-transcript-display";

function user(id: string, text: string): TranscriptMessage {
  return { kind: "message", id, role: "user", text, createdAt: "" };
}

function tool(callId: string, name: string): TranscriptMessage {
  return {
    kind: "tool",
    id: callId,
    callId,
    toolName: name,
    status: "success",
    label: `Ran ${name}`,
    createdAt: "",
  };
}

describe("transcriptWithSingleToolSlotAfterLastUser", () => {
  it("keeps full transcript when there is no user message", () => {
    const t: TranscriptMessage[] = [tool("a", "x")];
    expect(transcriptWithSingleToolSlotAfterLastUser(t)).toEqual(t);
  });

  it("keeps all tools from earlier turns; only last tool after final user", () => {
    const t: TranscriptMessage[] = [
      user("u1", "first"),
      tool("t1", "TaskCreate"),
      tool("t2", "bash"),
      user("u2", "second"),
      tool("t3", "TaskCreate"),
      tool("t4", "TaskUpdate"),
      tool("t5", "bash"),
    ];
    const out = transcriptWithSingleToolSlotAfterLastUser(t);
    expect(out.map((m) => (m.kind === "tool" ? m.callId : m.id))).toEqual([
      "u1",
      "t1",
      "t2",
      "u2",
      "t5",
    ]);
  });

  it("latestToolCallIdAfterLastUser returns last tool in tail", () => {
    const t: TranscriptMessage[] = [user("u", "x"), tool("a", "A"), tool("b", "B")];
    expect(latestToolCallIdAfterLastUser(t)).toBe("b");
  });
});
