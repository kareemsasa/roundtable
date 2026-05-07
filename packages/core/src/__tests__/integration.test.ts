import { describe, it, expect, beforeEach } from "vitest";
import { RoundtableEngine } from "../engine.js";
import { MockAdapter } from "@roundtable/adapters";
import { FileSessionStore } from "@roundtable/persistence";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { RoundtableConfig, ContextPack, SessionEvent, AgentAdapter } from "../types.js";

// === Helpers ===

function makeConfig(dataDir: string, overrides: Partial<RoundtableConfig["deliberation"]> = {}): RoundtableConfig {
  return {
    dataDir,
    context: { budgetBytes: 100_000, maxFiles: 50, maxFileBytes: 10_000, maxTreeDepth: 5 },
    deliberation: {
      maxRounds: 2,
      participantTimeoutMs: 120_000,
      deliberationTimeoutMs: 600_000,
      ...overrides,
    },
    adapters: {
      claude: { command: "claude", mode: "mock", limits: { invocationTimeoutMs: 120_000, maxOutputBytes: 512_000, gracefulShutdownMs: 5_000 } },
      codex: { command: "codex", mode: "mock", limits: { invocationTimeoutMs: 120_000, maxOutputBytes: 512_000, gracefulShutdownMs: 5_000 } },
      steward: { command: "claude", mode: "mock", limits: { invocationTimeoutMs: 120_000, maxOutputBytes: 512_000, gracefulShutdownMs: 5_000 } },
    },
  };
}

function mockContextPack(overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    id: `cp_${randomUUID().slice(0, 8)}`,
    version: 1,
    targetPath: "/tmp/test-project",
    displayPath: "test-project",
    createdAt: new Date().toISOString(),
    config: { budgetBytes: 100_000, maxFiles: 50, maxFileBytes: 10_000, maxTreeDepth: 5 },
    tree: { name: "test-project", type: "directory" },
    files: [],
    omitted: { categories: [], files: [] },
    stats: { totalFiles: 0, includedFiles: 0, totalBytes: 0, budgetBytes: 100_000 },
    ...overrides,
  };
}

function stewardDecision(
  status: "concluded" | "continue" | "needs_user",
  summary = "Test summary",
): string {
  return JSON.stringify({
    status,
    reason: `Steward says ${status}`,
    summary,
  });
}

async function collectEvents(iter: AsyncIterable<SessionEvent>): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for await (const event of iter) events.push(event);
  return events;
}

function eventsOfType(events: SessionEvent[], type: string): SessionEvent[] {
  return events.filter((e) => e.type === type);
}

/**
 * Creates a steward adapter that returns different decisions on successive calls.
 * Each entry in `decisions` is the response for that call index.
 */
function makeStewardSequence(decisions: string[]): AgentAdapter {
  let callCount = 0;
  const base = new MockAdapter({ id: "steward", response: decisions[0] });
  const originalInvoke = base.invoke.bind(base);

  base.invoke = async function* (input, signal) {
    const idx = callCount;
    callCount++;
    for await (const event of originalInvoke(input, signal)) {
      if (event.type === "response_end") {
        yield { ...event, content: decisions[Math.min(idx, decisions.length - 1)] };
      } else {
        yield event;
      }
    }
  };

  return base;
}

// === Test Suite ===

describe("Integration: full product loop with mock adapters", () => {
  let dataDir: string;
  let store: FileSessionStore;

  beforeEach(async () => {
    dataDir = join(tmpdir(), `roundtable-integ-${randomUUID()}`);
    await mkdir(dataDir, { recursive: true });
    store = new FileSessionStore(dataDir);
  });

  // ---------------------------------------------------------------
  // 1. Happy path: one-round deliberation
  // ---------------------------------------------------------------
  it("happy path: one-round deliberation with correct event sequence and meta updates", async () => {
    const config = makeConfig(dataDir);
    const engine = new RoundtableEngine({
      store,
      adapters: {
        claude: new MockAdapter({ id: "claude", response: "Claude's analysis of the codebase." }),
        codex: new MockAdapter({ id: "codex", response: "Codex's implementation suggestion." }),
        steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded", "The team reached consensus.") }),
      },
      config,
    });

    const cp = mockContextPack();
    const session = await engine.startSession("/tmp/test-project", cp);

    // Verify session starts awaiting_user
    expect(session.meta.status).toBe("awaiting_user");

    const events = await collectEvents(engine.submitMessage(session, "Please review the code."));

    // Verify event sequence
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("user_message");
    expect(types[1]).toBe("deliberation_started");
    expect(types[types.length - 1]).toBe("deliberation_ended");

    // Verify claude and codex both responded
    const claudeResponses = eventsOfType(events, "agent_response_end").filter((e) => e.participant === "claude");
    const codexResponses = eventsOfType(events, "agent_response_end").filter((e) => e.participant === "codex");
    expect(claudeResponses).toHaveLength(1);
    expect(codexResponses).toHaveLength(1);

    // Verify steward_decision with "concluded"
    const stewardDecisions = eventsOfType(events, "steward_decision");
    expect(stewardDecisions).toHaveLength(1);
    expect(stewardDecisions[0].data.status).toBe("concluded");
    expect(stewardDecisions[0].data.summary).toBe("The team reached consensus.");

    // Verify deliberation_ended reason
    const ended = events[events.length - 1];
    expect(ended.data.reason).toBe("concluded");
    expect(ended.data.rounds).toBe(1);

    // Verify session meta returns to awaiting_user
    expect(session.meta.status).toBe("awaiting_user");

    // Verify latestStewardSummary was set
    expect(session.meta.latestStewardSummary).toBe("The team reached consensus.");

    // Verify from persisted store too
    const loadedMeta = await store.loadSession(session.meta.id);
    expect(loadedMeta.status).toBe("awaiting_user");
    expect(loadedMeta.latestStewardSummary).toBe("The team reached consensus.");
  });

  // ---------------------------------------------------------------
  // 2. Steward requests continue -> second round
  // ---------------------------------------------------------------
  it("steward requests continue then concludes on second round", async () => {
    const config = makeConfig(dataDir);
    const engine = new RoundtableEngine({
      store,
      adapters: {
        claude: new MockAdapter({ id: "claude", response: "Claude's analysis." }),
        codex: new MockAdapter({ id: "codex", response: "Codex's analysis." }),
        steward: makeStewardSequence([
          stewardDecision("continue", "Need more discussion"),
          stewardDecision("concluded", "Consensus reached"),
        ]),
      },
      config,
    });

    const cp = mockContextPack();
    const session = await engine.startSession("/tmp/test-project", cp);
    const events = await collectEvents(engine.submitMessage(session, "Refactor the auth module."));

    // Verify 4 agent_response_end events for claude+codex (2 rounds x 2 participants)
    const participantResponses = eventsOfType(events, "agent_response_end").filter(
      (e) => e.participant === "claude" || e.participant === "codex",
    );
    expect(participantResponses).toHaveLength(4);

    // Verify 2 steward_decision events
    const stewardDecisions = eventsOfType(events, "steward_decision");
    expect(stewardDecisions).toHaveLength(2);
    expect(stewardDecisions[0].data.status).toBe("continue");
    expect(stewardDecisions[1].data.status).toBe("concluded");

    // Verify deliberation ended as concluded after 2 rounds
    const ended = events[events.length - 1];
    expect(ended.type).toBe("deliberation_ended");
    expect(ended.data.reason).toBe("concluded");
    expect(ended.data.rounds).toBe(2);
  });

  // ---------------------------------------------------------------
  // 3. Max rounds override
  // ---------------------------------------------------------------
  it("maxRounds=1 stops deliberation even when steward says continue", async () => {
    const config = makeConfig(dataDir, { maxRounds: 1 });
    const engine = new RoundtableEngine({
      store,
      adapters: {
        claude: new MockAdapter({ id: "claude", response: "Claude response." }),
        codex: new MockAdapter({ id: "codex", response: "Codex response." }),
        steward: new MockAdapter({ id: "steward", response: stewardDecision("continue", "Keep going") }),
      },
      config,
    });

    const cp = mockContextPack();
    const session = await engine.startSession("/tmp/test-project", cp);
    const events = await collectEvents(engine.submitMessage(session, "Do this task."));

    // Only 1 round of claude+codex
    const participantResponses = eventsOfType(events, "agent_response_end").filter(
      (e) => e.participant === "claude" || e.participant === "codex",
    );
    expect(participantResponses).toHaveLength(2);

    // Deliberation ended with max_rounds_reached
    const ended = events[events.length - 1];
    expect(ended.type).toBe("deliberation_ended");
    expect(ended.data.reason).toBe("max_rounds_reached");
    expect(ended.data.rounds).toBe(1);

    // Session should still return to awaiting_user
    expect(session.meta.status).toBe("awaiting_user");
  });

  // ---------------------------------------------------------------
  // 4. needs_user
  // ---------------------------------------------------------------
  it("steward returns needs_user and deliberation ends with session awaiting_user", async () => {
    const config = makeConfig(dataDir);
    const engine = new RoundtableEngine({
      store,
      adapters: {
        claude: new MockAdapter({ id: "claude", response: "Claude needs clarification." }),
        codex: new MockAdapter({ id: "codex", response: "Codex needs clarification." }),
        steward: new MockAdapter({
          id: "steward",
          response: stewardDecision("needs_user", "User needs to clarify requirements"),
        }),
      },
      config,
    });

    const cp = mockContextPack();
    const session = await engine.startSession("/tmp/test-project", cp);
    const events = await collectEvents(engine.submitMessage(session, "Build a feature."));

    // Steward decision is needs_user
    const stewardDecisions = eventsOfType(events, "steward_decision");
    expect(stewardDecisions).toHaveLength(1);
    expect(stewardDecisions[0].data.status).toBe("needs_user");

    // Deliberation ended with needs_user reason
    const ended = events[events.length - 1];
    expect(ended.type).toBe("deliberation_ended");
    expect(ended.data.reason).toBe("needs_user");

    // Session returns to awaiting_user
    expect(session.meta.status).toBe("awaiting_user");
    const loadedMeta = await store.loadSession(session.meta.id);
    expect(loadedMeta.status).toBe("awaiting_user");
  });

  // ---------------------------------------------------------------
  // 5. Single participant failure (claude fails)
  // ---------------------------------------------------------------
  it("single participant failure: claude errors but codex and steward still work", async () => {
    const config = makeConfig(dataDir);
    const engine = new RoundtableEngine({
      store,
      adapters: {
        claude: new MockAdapter({ id: "claude", error: "Claude process crashed unexpectedly" }),
        codex: new MockAdapter({ id: "codex", response: "Codex's solid implementation." }),
        steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded", "Codex provided adequate solution.") }),
      },
      config,
    });

    const cp = mockContextPack();
    const session = await engine.startSession("/tmp/test-project", cp);
    const events = await collectEvents(engine.submitMessage(session, "Fix the bug."));

    // Verify agent_error event exists with participant "roundtable"
    const errors = eventsOfType(events, "agent_error");
    expect(errors).toHaveLength(1);
    expect(errors[0].participant).toBe("roundtable");
    expect(errors[0].data.error).toContain("Claude process crashed unexpectedly");

    // Verify Codex still responds
    const codexResponses = eventsOfType(events, "agent_response_end").filter((e) => e.participant === "codex");
    expect(codexResponses).toHaveLength(1);
    expect(codexResponses[0].data.content).toBe("Codex's solid implementation.");

    // Verify Steward still evaluates
    const stewardDecisions = eventsOfType(events, "steward_decision");
    expect(stewardDecisions).toHaveLength(1);
    expect(stewardDecisions[0].data.status).toBe("concluded");

    // Deliberation ends normally
    const ended = events[events.length - 1];
    expect(ended.type).toBe("deliberation_ended");
    expect(ended.data.reason).toBe("concluded");

    // Session returns to awaiting_user
    expect(session.meta.status).toBe("awaiting_user");
  });

  // ---------------------------------------------------------------
  // 6. Double participant failure (both fail)
  // ---------------------------------------------------------------
  it("double participant failure: both claude and codex error, steward not invoked", async () => {
    const config = makeConfig(dataDir);
    const engine = new RoundtableEngine({
      store,
      adapters: {
        claude: new MockAdapter({ id: "claude", error: "Claude crashed" }),
        codex: new MockAdapter({ id: "codex", error: "Codex crashed" }),
        steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded") }),
      },
      config,
    });

    const cp = mockContextPack();
    const session = await engine.startSession("/tmp/test-project", cp);
    const events = await collectEvents(engine.submitMessage(session, "Analyze the code."));

    // Verify 2 agent_error events
    const errors = eventsOfType(events, "agent_error");
    expect(errors).toHaveLength(2);

    // Verify deliberation_ended with reason "double_failure"
    const ended = events[events.length - 1];
    expect(ended.type).toBe("deliberation_ended");
    expect(ended.data.reason).toBe("double_failure");

    // Verify NO steward_decision event exists
    const stewardDecisions = eventsOfType(events, "steward_decision");
    expect(stewardDecisions).toHaveLength(0);

    // No steward response_end events either
    const stewardResponses = eventsOfType(events, "agent_response_end").filter(
      (e) => e.participant === "steward",
    );
    expect(stewardResponses).toHaveLength(0);

    // Session still returns to awaiting_user (recoverable state)
    expect(session.meta.status).toBe("awaiting_user");
  });

  // ---------------------------------------------------------------
  // 7. Steward invalid JSON output
  // ---------------------------------------------------------------
  it("steward returns invalid JSON: parse error emitted and deliberation ends safely", async () => {
    const config = makeConfig(dataDir);
    const engine = new RoundtableEngine({
      store,
      adapters: {
        claude: new MockAdapter({ id: "claude", response: "Claude's thoughts." }),
        codex: new MockAdapter({ id: "codex", response: "Codex's thoughts." }),
        steward: new MockAdapter({ id: "steward", response: "I think we should continue working on this." }),
      },
      config,
    });

    const cp = mockContextPack();
    const session = await engine.startSession("/tmp/test-project", cp);
    const events = await collectEvents(engine.submitMessage(session, "Review this."));

    // Verify steward_parse_error event exists
    const parseErrors = eventsOfType(events, "steward_parse_error");
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0].participant).toBe("roundtable");
    expect(parseErrors[0].data.rawContent).toBe("I think we should continue working on this.");

    // Verify deliberation ends safely with steward_parse_error reason
    const ended = events[events.length - 1];
    expect(ended.type).toBe("deliberation_ended");
    expect(ended.data.reason).toBe("steward_parse_error");

    // Verify NO steward_decision event
    const stewardDecisions = eventsOfType(events, "steward_decision");
    expect(stewardDecisions).toHaveLength(0);

    // Session still usable
    expect(session.meta.status).toBe("awaiting_user");
  });

  // ---------------------------------------------------------------
  // 8. Session survives errors and remains usable
  // ---------------------------------------------------------------
  it("session survives errors: second deliberation works after first has an error", async () => {
    const config = makeConfig(dataDir);

    // First deliberation: Claude errors
    const errorAdapters = {
      claude: new MockAdapter({ id: "claude", error: "Claude failed" }),
      codex: new MockAdapter({ id: "codex", response: "Codex works in round 1." }),
      steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded", "Partial results.") }),
    };

    const engine1 = new RoundtableEngine({
      store,
      adapters: errorAdapters,
      config,
    });

    const cp = mockContextPack();
    const session = await engine1.startSession("/tmp/test-project", cp);
    const events1 = await collectEvents(engine1.submitMessage(session, "First message."));

    // Verify first deliberation had an error
    const errors = eventsOfType(events1, "agent_error");
    expect(errors.length).toBeGreaterThanOrEqual(1);

    const eventCountAfterFirst = session.events.length;

    // Second deliberation: everything works
    const successAdapters = {
      claude: new MockAdapter({ id: "claude", response: "Claude works now." }),
      codex: new MockAdapter({ id: "codex", response: "Codex works in round 2." }),
      steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded", "Full consensus.") }),
    };

    const engine2 = new RoundtableEngine({
      store,
      adapters: successAdapters,
      config,
    });

    const events2 = await collectEvents(engine2.submitMessage(session, "Second message."));

    // Verify second deliberation completes successfully
    const types2 = events2.map((e) => e.type);
    expect(types2).toContain("user_message");
    expect(types2).toContain("deliberation_started");
    expect(types2).toContain("steward_decision");
    expect(types2[types2.length - 1]).toBe("deliberation_ended");

    // No errors in the second deliberation
    const errors2 = eventsOfType(events2, "agent_error");
    expect(errors2).toHaveLength(0);

    // Verify second deliberation ended with concluded
    const ended2 = events2[events2.length - 1];
    expect(ended2.data.reason).toBe("concluded");

    // Verify total event count across both deliberations is correct
    expect(session.events.length).toBe(eventCountAfterFirst + events2.length);

    // Session is in usable state
    expect(session.meta.status).toBe("awaiting_user");
    expect(session.meta.latestStewardSummary).toBe("Full consensus.");
  });

  // ---------------------------------------------------------------
  // 9. Event log correctness after replay
  // ---------------------------------------------------------------
  it("event log correctness: resumed session matches original events", async () => {
    const config = makeConfig(dataDir);
    const engine = new RoundtableEngine({
      store,
      adapters: {
        claude: new MockAdapter({ id: "claude", response: "Claude's replay-test response." }),
        codex: new MockAdapter({ id: "codex", response: "Codex's replay-test response." }),
        steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded", "Replay summary.") }),
      },
      config,
    });

    const cp = mockContextPack();
    const session = await engine.startSession("/tmp/test-project", cp);
    await collectEvents(engine.submitMessage(session, "Test replay."));

    const originalEventCount = session.events.length;
    expect(originalEventCount).toBeGreaterThan(2); // at least lifecycle + deliberation events

    // Resume the session (reloads from disk)
    const resumed = await engine.resumeSession(session.meta.id);

    // Verify resumed session events match original event count
    expect(resumed.events.length).toBe(originalEventCount);

    // Verify each event has required fields
    for (const event of resumed.events) {
      expect(event.id).toBeDefined();
      expect(event.id).toMatch(/^evt_/);
      expect(event.type).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO date prefix
      expect(event.sessionId).toBe(session.meta.id);
    }

    // Verify event types match between original and resumed
    const originalTypes = session.events.map((e) => e.type);
    const resumedTypes = resumed.events.map((e) => e.type);
    expect(resumedTypes).toEqual(originalTypes);

    // Verify event IDs match (proves they are the same events, not regenerated)
    const originalIds = session.events.map((e) => e.id);
    const resumedIds = resumed.events.map((e) => e.id);
    expect(resumedIds).toEqual(originalIds);

    // Verify resumed meta matches
    expect(resumed.meta.id).toBe(session.meta.id);
    expect(resumed.meta.status).toBe("awaiting_user");
    expect(resumed.meta.latestStewardSummary).toBe("Replay summary.");
  });

  // ---------------------------------------------------------------
  // 10. refreshContext updates context pack between deliberations
  // ---------------------------------------------------------------
  it("refreshContext updates context pack id and emits event between deliberations", async () => {
    const config = makeConfig(dataDir);
    const engine = new RoundtableEngine({
      store,
      adapters: {
        claude: new MockAdapter({ id: "claude", response: "Claude response." }),
        codex: new MockAdapter({ id: "codex", response: "Codex response." }),
        steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded", "Done.") }),
      },
      config,
    });

    // Start session with context pack v1
    const cpV1 = mockContextPack({ version: 1 });
    const session = await engine.startSession("/tmp/test-project", cpV1);

    expect(session.meta.currentContextPackId).toBe(cpV1.id);

    // Run a deliberation
    await collectEvents(engine.submitMessage(session, "First pass."));

    const eventsBeforeRefresh = session.events.length;

    // Call refreshContext with a new context pack v2
    const cpV2 = mockContextPack({ version: 2 });
    await engine.refreshContext(session, cpV2);

    // Verify meta.currentContextPackId is updated
    expect(session.meta.currentContextPackId).toBe(cpV2.id);

    // Verify from persisted store
    const loadedMeta = await store.loadSession(session.meta.id);
    expect(loadedMeta.currentContextPackId).toBe(cpV2.id);

    // Verify a context_pack_built event was emitted
    const allContextPackEvents = eventsOfType(session.events, "context_pack_built");
    // Should have 3: one from startSession, one from deliberation (none actually — only engine emits it), one from refreshContext
    // Actually: startSession emits one, refreshContext emits one = 2 total
    expect(allContextPackEvents.length).toBeGreaterThanOrEqual(2);

    // The latest context_pack_built event should reference cpV2
    const latestCpEvent = allContextPackEvents[allContextPackEvents.length - 1];
    expect(latestCpEvent.data.contextPackId).toBe(cpV2.id);
    expect(latestCpEvent.data.version).toBe(2);

    // Verify new event was appended
    expect(session.events.length).toBe(eventsBeforeRefresh + 1);

    // Verify context pack can be loaded from store
    const loadedPack = await store.loadContextPack(session.meta.id, cpV2.id);
    expect(loadedPack.id).toBe(cpV2.id);
    expect(loadedPack.version).toBe(2);
  });
});
