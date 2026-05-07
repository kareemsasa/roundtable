import { describe, it, expect } from "vitest";
import { StewardDecisionSchema, SessionEventSchema } from "../schemas.js";

describe("StewardDecisionSchema", () => {
  it("parses a valid concluded decision", () => {
    const input = {
      status: "concluded",
      reason: "Both participants agree",
      summary: "The team should refactor the auth module",
    };
    const result = StewardDecisionSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("concluded");
      expect(result.data.decisionPoint).toBeUndefined();
    }
  });

  it("parses a continue decision with all optional fields", () => {
    const input = {
      status: "continue",
      reason: "Disagreement on approach",
      summary: "Claude prefers adapter pattern, Codex prefers rewrite",
      decisionPoint: "Whether to refactor incrementally or replace wholesale",
      recommendedActions: ["Review the session handler", "Check token storage"],
      nextSpeakerHint: "claude",
    };
    const result = StewardDecisionSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const input = {
      status: "invalid",
      reason: "test",
      summary: "test",
    };
    const result = StewardDecisionSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const input = { status: "concluded" };
    const result = StewardDecisionSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("SessionEventSchema", () => {
  it("parses a user_message event", () => {
    const input = {
      id: "evt_001",
      type: "user_message",
      timestamp: "2026-05-06T12:00:00Z",
      sessionId: "sess_001",
      participant: "user",
      data: { content: "Hello world" },
    };
    const result = SessionEventSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("parses an event with optional fields omitted", () => {
    const input = {
      id: "evt_002",
      type: "session_started",
      timestamp: "2026-05-06T12:00:00Z",
      sessionId: "sess_001",
      data: {},
    };
    const result = SessionEventSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects unknown event type", () => {
    const input = {
      id: "evt_003",
      type: "unknown_type",
      timestamp: "2026-05-06T12:00:00Z",
      sessionId: "sess_001",
      data: {},
    };
    const result = SessionEventSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
