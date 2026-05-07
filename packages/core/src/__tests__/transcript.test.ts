import { describe, it, expect } from "vitest";
import { buildTranscript } from "../transcript.js";
import type { SessionEvent } from "../types.js";

function makeEvent(
  type: string,
  participant: string,
  data: Record<string, unknown>,
): SessionEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: type as SessionEvent["type"],
    timestamp: new Date().toISOString(),
    sessionId: "sess_001",
    participant: participant as SessionEvent["participant"],
    data,
  };
}

describe("buildTranscript", () => {
  it("includes user messages", () => {
    const events = [makeEvent("user_message", "user", { content: "What should I do?" })];
    const transcript = buildTranscript(events);
    expect(transcript).toHaveLength(1);
    expect(transcript[0].participant).toBe("user");
    expect(transcript[0].content).toBe("What should I do?");
  });

  it("includes agent responses", () => {
    const events = [
      makeEvent("agent_response_end", "claude", { content: "Refactor auth.", durationMs: 3000, exitCode: 0 }),
    ];
    const transcript = buildTranscript(events);
    expect(transcript).toHaveLength(1);
    expect(transcript[0].participant).toBe("claude");
    expect(transcript[0].content).toBe("Refactor auth.");
  });

  it("includes steward decisions as summary text", () => {
    const events = [
      makeEvent("steward_decision", "steward", {
        status: "concluded", reason: "Consensus", summary: "Both agree on refactoring.",
      }),
    ];
    const transcript = buildTranscript(events);
    expect(transcript).toHaveLength(1);
    expect(transcript[0].content).toBe("Both agree on refactoring.");
  });

  it("includes visible errors as roundtable messages", () => {
    const events = [
      makeEvent("agent_error", "roundtable", { error: "Codex failed: timeout after 120s." }),
    ];
    const transcript = buildTranscript(events);
    expect(transcript).toHaveLength(1);
    expect(transcript[0].participant).toBe("roundtable");
    expect(transcript[0].content).toContain("Codex failed");
  });

  it("excludes non-display events", () => {
    const events = [
      makeEvent("agent_invocation_started", "claude", { invocationId: "inv_001" }),
      makeEvent("agent_chunk", "claude", { content: "partial", stream: "stdout" }),
      makeEvent("engine_state_changed", "roundtable", { from: "x", to: "y", reason: "z" }),
    ];
    const transcript = buildTranscript(events);
    expect(transcript).toHaveLength(0);
  });

  it("preserves event order", () => {
    const events = [
      makeEvent("user_message", "user", { content: "First" }),
      makeEvent("agent_response_end", "claude", { content: "Second", durationMs: 0, exitCode: 0 }),
      makeEvent("agent_response_end", "codex", { content: "Third", durationMs: 0, exitCode: 0 }),
    ];
    const transcript = buildTranscript(events);
    expect(transcript.map((t) => t.content)).toEqual(["First", "Second", "Third"]);
  });

  it("enforces transcript budget by keeping recent messages", () => {
    const events = [
      makeEvent("user_message", "user", { content: "A".repeat(100) }),
      makeEvent("agent_response_end", "claude", { content: "B".repeat(100) }),
      makeEvent("user_message", "user", { content: "C".repeat(100) }),
      makeEvent("agent_response_end", "codex", { content: "D".repeat(100) }),
    ];
    // Budget fits ~2 messages
    const transcript = buildTranscript(events, 250);
    // Should keep the most recent messages and prepend an omission notice
    const omissionMsg = transcript.find((t) => t.content.includes("omitted"));
    expect(omissionMsg).toBeDefined();
    expect(omissionMsg!.participant).toBe("roundtable");
    // Most recent messages should be present
    expect(transcript[transcript.length - 1].content).toBe("D".repeat(100));
  });

  it("returns all messages when budget is not specified", () => {
    const events = [
      makeEvent("user_message", "user", { content: "A".repeat(1000) }),
      makeEvent("user_message", "user", { content: "B".repeat(1000) }),
    ];
    const transcript = buildTranscript(events);
    expect(transcript).toHaveLength(2);
  });
});
