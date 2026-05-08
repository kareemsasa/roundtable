import { describe, it, expect } from "vitest";
import type { SessionEvent, StewardDecision } from "@roundtable/core";
import { generateTranscriptMarkdown, generateStewardSummaryMarkdown } from "../markdown-export.js";

function makeEvent(overrides: Partial<SessionEvent>): SessionEvent {
  return {
    id: "evt_001",
    type: "user_message",
    timestamp: "2026-05-06T12:00:00Z",
    sessionId: "sess_001",
    data: {},
    ...overrides,
  };
}

describe("generateTranscriptMarkdown", () => {
  it("renders user messages and agent responses", () => {
    const events: SessionEvent[] = [
      makeEvent({
        id: "evt_1",
        type: "user_message",
        participant: "user",
        data: { content: "What should we refactor?" },
      }),
      makeEvent({
        id: "evt_2",
        type: "agent_response_end",
        participant: "claude",
        data: { content: "I suggest starting with the auth module." },
      }),
      makeEvent({
        id: "evt_3",
        type: "agent_response_end",
        participant: "codex",
        data: { content: "I agree, the auth module has the most tech debt." },
      }),
    ];

    const md = generateTranscriptMarkdown(events, "sess_001");
    expect(md).toContain("# Roundtable Transcript");
    expect(md).toContain("Session: `sess_001`");
    expect(md).toContain("**You**");
    expect(md).toContain("What should we refactor?");
    expect(md).toContain("**Claude**");
    expect(md).toContain("I suggest starting with the auth module.");
    expect(md).toContain("**Codex**");
    expect(md).toContain("I agree, the auth module has the most tech debt.");
  });

  it("renders steward decisions", () => {
    const decision: StewardDecision = {
      status: "continue",
      reason: "Disagreement remains",
      summary: "Claude and Codex disagree on approach",
    };
    const events: SessionEvent[] = [
      makeEvent({
        id: "evt_s",
        type: "steward_decision",
        participant: "steward",
        data: decision as unknown as Record<string, unknown>,
      }),
    ];

    const md = generateTranscriptMarkdown(events, "sess_002");
    expect(md).toContain("**Steward**");
    expect(md).toContain("Claude and Codex disagree on approach");
  });

  it("excludes steward agent_response_end (raw JSON) from transcript", () => {
    const events: SessionEvent[] = [
      makeEvent({
        id: "evt_u",
        type: "user_message",
        participant: "user",
        data: { content: "Hello" },
      }),
      makeEvent({
        id: "evt_sr",
        type: "agent_response_end",
        participant: "steward",
        data: {
          content: '{"status":"concluded","reason":"done","summary":"All good"}',
        },
      }),
      makeEvent({
        id: "evt_sd",
        type: "steward_decision",
        participant: "steward",
        data: {
          status: "concluded",
          reason: "done",
          summary: "All good",
        } as unknown as Record<string, unknown>,
      }),
    ];

    const md = generateTranscriptMarkdown(events, "sess_raw");
    // Raw JSON should NOT appear
    expect(md).not.toContain('"status"');
    expect(md).not.toContain('"reason"');
    expect(md).not.toContain('"summary"');
    // Rendered summary should appear
    expect(md).toContain("All good");
    // Only one Steward section, not two
    const stewardCount = (md.match(/\*\*Steward\*\*/g) ?? []).length;
    expect(stewardCount).toBe(1);
  });

  it("renders decisionPoint and recommendedActions in steward decision", () => {
    const decision: StewardDecision = {
      status: "needs_user",
      reason: "Ambiguous scope",
      summary: "Need user clarification",
      decisionPoint: "Should we include the database layer?",
      recommendedActions: ["Review auth handler", "Check token storage"],
    };
    const events: SessionEvent[] = [
      makeEvent({
        id: "evt_sd2",
        type: "steward_decision",
        participant: "steward",
        data: decision as unknown as Record<string, unknown>,
      }),
    ];

    const md = generateTranscriptMarkdown(events, "sess_detail");
    expect(md).toContain("Need user clarification");
    expect(md).toContain("**Decision Point:** Should we include the database layer?");
    expect(md).toContain("**Recommended Actions:**");
    expect(md).toContain("- Review auth handler");
    expect(md).toContain("- Check token storage");
  });

  it("omits decisionPoint and recommendedActions when not present", () => {
    const decision: StewardDecision = {
      status: "concluded",
      reason: "Done",
      summary: "All good",
    };
    const events: SessionEvent[] = [
      makeEvent({
        id: "evt_sd3",
        type: "steward_decision",
        participant: "steward",
        data: decision as unknown as Record<string, unknown>,
      }),
    ];

    const md = generateTranscriptMarkdown(events, "sess_nodp");
    expect(md).toContain("All good");
    expect(md).not.toContain("**Decision Point:**");
    expect(md).not.toContain("**Recommended Actions:**");
  });

  it("renders agent errors with Roundtable label", () => {
    const events: SessionEvent[] = [
      makeEvent({
        id: "evt_e",
        type: "agent_error",
        participant: "roundtable",
        data: { error: "Claude process timed out after 60s" },
      }),
    ];

    const md = generateTranscriptMarkdown(events, "sess_003");
    expect(md).toContain("**Roundtable**");
    expect(md).toContain("Claude process timed out after 60s");
  });

  it("skips non-display events", () => {
    const events: SessionEvent[] = [
      makeEvent({
        id: "evt_skip",
        type: "agent_chunk",
        participant: "claude",
        data: { content: "partial" },
      }),
      makeEvent({
        id: "evt_show",
        type: "user_message",
        participant: "user",
        data: { content: "Hello" },
      }),
    ];

    const md = generateTranscriptMarkdown(events, "sess_004");
    expect(md).not.toContain("partial");
    expect(md).toContain("Hello");
  });

  it("skips events without a participant", () => {
    const events: SessionEvent[] = [
      makeEvent({
        id: "evt_no_p",
        type: "user_message",
        // no participant
        data: { content: "orphan" },
      }),
    ];

    const md = generateTranscriptMarkdown(events, "sess_005");
    expect(md).not.toContain("orphan");
  });
});

describe("generateStewardSummaryMarkdown", () => {
  it("renders a basic steward summary", () => {
    const decision: StewardDecision = {
      status: "concluded",
      reason: "Both participants agree on the approach",
      summary: "Refactor auth module incrementally",
    };

    const md = generateStewardSummaryMarkdown(decision);
    expect(md).toContain("# Steward Summary");
    expect(md).toContain("**Status:** concluded");
    expect(md).toContain("**Reason:** Both participants agree on the approach");
    expect(md).toContain("## Summary");
    expect(md).toContain("Refactor auth module incrementally");
  });

  it("renders optional decisionPoint", () => {
    const decision: StewardDecision = {
      status: "needs_user",
      reason: "Ambiguous requirements",
      summary: "Need clarification on scope",
      decisionPoint: "Should we include the database layer?",
    };

    const md = generateStewardSummaryMarkdown(decision);
    expect(md).toContain("## Decision Point");
    expect(md).toContain("Should we include the database layer?");
  });

  it("renders optional recommendedActions", () => {
    const decision: StewardDecision = {
      status: "continue",
      reason: "More discussion needed",
      summary: "Exploring options",
      recommendedActions: ["Review auth handler", "Check token storage", "Profile query latency"],
    };

    const md = generateStewardSummaryMarkdown(decision);
    expect(md).toContain("## Recommended Actions");
    expect(md).toContain("- Review auth handler");
    expect(md).toContain("- Check token storage");
    expect(md).toContain("- Profile query latency");
  });

  it("omits optional sections when not provided", () => {
    const decision: StewardDecision = {
      status: "concluded",
      reason: "Done",
      summary: "All good",
    };

    const md = generateStewardSummaryMarkdown(decision);
    expect(md).not.toContain("## Decision Point");
    expect(md).not.toContain("## Recommended Actions");
  });
});
