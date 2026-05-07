import { describe, it, expect } from "vitest";
import { MockAdapter } from "@roundtable/adapters";
import { runDeliberation } from "../turn-loop.js";
import type { DeliberationInput } from "../turn-loop.js";
import type { ContextPack, SessionEvent } from "../types.js";

/** Minimal context pack for tests */
function makeContextPack(): ContextPack {
  return {
    id: "ctx_test001",
    version: 1,
    targetPath: "/test/project",
    displayPath: "test/project",
    createdAt: new Date().toISOString(),
    config: {
      budgetBytes: 100_000,
      maxFiles: 50,
      maxFileBytes: 10_000,
      maxTreeDepth: 5,
    },
    tree: { name: "project", type: "directory" },
    files: [],
    omitted: { categories: [], files: [] },
    stats: {
      totalFiles: 0,
      includedFiles: 0,
      totalBytes: 0,
      budgetBytes: 100_000,
    },
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
    decisionPoint: "test",
  });
}

function makeInput(overrides: Partial<DeliberationInput> = {}): DeliberationInput {
  return {
    sessionId: "sess_test001",
    userMessage: "Please refactor the auth module.",
    contextPack: makeContextPack(),
    priorTranscript: [],
    adapters: {
      claude: new MockAdapter({ id: "claude", response: "I suggest refactoring the middleware." }),
      codex: new MockAdapter({ id: "codex", response: "I would restructure the handlers." }),
      steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded") }),
    },
    limits: {
      maxRounds: 2,
      participantTimeoutMs: 120_000,
      deliberationTimeoutMs: 600_000,
    },
    systemPrompts: {
      claude: "You are Claude.",
      codex: "You are Codex.",
      steward: "You are the steward.",
    },
    ...overrides,
  };
}

async function collectEvents(input: DeliberationInput): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for await (const event of runDeliberation(input)) {
    events.push(event);
  }
  return events;
}

function eventTypes(events: SessionEvent[]): string[] {
  return events.map((e) => e.type);
}

function eventsOfType(events: SessionEvent[], type: string): SessionEvent[] {
  return events.filter((e) => e.type === type);
}

describe("runDeliberation", () => {
  it("happy path: full round, steward concludes", async () => {
    const events = await collectEvents(makeInput());
    const types = eventTypes(events);

    // Must start with user_message and deliberation_started
    expect(types[0]).toBe("user_message");
    expect(types[1]).toBe("deliberation_started");

    // Must end with deliberation_ended
    expect(types[types.length - 1]).toBe("deliberation_ended");

    // Should have agent_response_end for claude and codex
    const responseEnds = eventsOfType(events, "agent_response_end");
    expect(responseEnds).toHaveLength(3); // claude + codex + steward
    expect(responseEnds.map((e) => e.participant)).toContain("claude");
    expect(responseEnds.map((e) => e.participant)).toContain("codex");

    // Should have steward_decision
    const stewardDecisions = eventsOfType(events, "steward_decision");
    expect(stewardDecisions).toHaveLength(1);
    expect(stewardDecisions[0].participant).toBe("steward");
    expect(stewardDecisions[0].data.status).toBe("concluded");

    // Deliberation ended with reason "concluded"
    const ended = events[events.length - 1];
    expect(ended.data.reason).toBe("concluded");
    expect(ended.data.rounds).toBe(1);

    // All events should have sessionId set
    for (const event of events) {
      expect(event.sessionId).toBe("sess_test001");
    }

    // All events after deliberation_started should have deliberationId
    const delStartIdx = types.indexOf("deliberation_started");
    for (let i = delStartIdx; i < events.length; i++) {
      expect(events[i].deliberationId).toBeDefined();
    }

    // All event IDs should start with evt_
    for (const event of events) {
      expect(event.id).toMatch(/^evt_/);
    }
  });

  it("continue then conclude: steward says continue first time, concludes second", async () => {
    let stewardCallCount = 0;
    const stewardAdapter = new MockAdapter({
      id: "steward",
      response: stewardDecision("continue"),
    });

    // Override invoke to return different responses on each call
    const originalInvoke = stewardAdapter.invoke.bind(stewardAdapter);
    stewardAdapter.invoke = async function* (input, signal) {
      stewardCallCount++;
      if (stewardCallCount === 1) {
        // First call: continue
        for await (const event of originalInvoke(input, signal)) {
          if (event.type === "response_end") {
            yield { ...event, content: stewardDecision("continue", "Need more discussion") };
          } else {
            yield event;
          }
        }
      } else {
        // Second call: conclude
        for await (const event of originalInvoke(input, signal)) {
          if (event.type === "response_end") {
            yield { ...event, content: stewardDecision("concluded", "Consensus reached") };
          } else {
            yield event;
          }
        }
      }
    };

    const events = await collectEvents(
      makeInput({
        adapters: {
          claude: new MockAdapter({ id: "claude", response: "Claude round response" }),
          codex: new MockAdapter({ id: "codex", response: "Codex round response" }),
          steward: stewardAdapter,
        },
      }),
    );

    // Should have 4 agent_response_end events for claude+codex (2 rounds x 2 participants)
    const agentResponses = eventsOfType(events, "agent_response_end").filter(
      (e) => e.participant === "claude" || e.participant === "codex",
    );
    expect(agentResponses).toHaveLength(4);

    // Should have 2 steward_decision events
    const stewardDecisions = eventsOfType(events, "steward_decision");
    expect(stewardDecisions).toHaveLength(2);
    expect(stewardDecisions[0].data.status).toBe("continue");
    expect(stewardDecisions[1].data.status).toBe("concluded");

    // Should end with deliberation_ended
    const ended = events[events.length - 1];
    expect(ended.type).toBe("deliberation_ended");
    expect(ended.data.reason).toBe("concluded");
    expect(ended.data.rounds).toBe(2);
  });

  it("max rounds enforced: steward always says continue, maxRounds=1", async () => {
    const events = await collectEvents(
      makeInput({
        adapters: {
          claude: new MockAdapter({ id: "claude", response: "Claude says things" }),
          codex: new MockAdapter({ id: "codex", response: "Codex says things" }),
          steward: new MockAdapter({ id: "steward", response: stewardDecision("continue") }),
        },
        limits: {
          maxRounds: 1,
          participantTimeoutMs: 120_000,
          deliberationTimeoutMs: 600_000,
        },
      }),
    );

    // Only one round of claude+codex
    const agentResponses = eventsOfType(events, "agent_response_end").filter(
      (e) => e.participant === "claude" || e.participant === "codex",
    );
    expect(agentResponses).toHaveLength(2);

    // Deliberation ended with max_rounds_reached
    const ended = events[events.length - 1];
    expect(ended.type).toBe("deliberation_ended");
    expect(ended.data.reason).toBe("max_rounds_reached");
    expect(ended.data.rounds).toBe(1);
  });

  it("single participant failure: claude errors, codex works", async () => {
    const events = await collectEvents(
      makeInput({
        adapters: {
          claude: new MockAdapter({ id: "claude", error: "Claude process crashed" }),
          codex: new MockAdapter({ id: "codex", response: "Codex works fine" }),
          steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded") }),
        },
      }),
    );

    // Should have an agent_error for claude
    const errors = eventsOfType(events, "agent_error");
    expect(errors).toHaveLength(1);
    expect(errors[0].participant).toBe("roundtable");
    expect(errors[0].data.error).toContain("Claude process crashed");

    // Codex should still respond
    const codexResponses = eventsOfType(events, "agent_response_end").filter(
      (e) => e.participant === "codex",
    );
    expect(codexResponses).toHaveLength(1);

    // Steward should still be called
    const stewardDecisions = eventsOfType(events, "steward_decision");
    expect(stewardDecisions).toHaveLength(1);

    // Should end normally
    const ended = events[events.length - 1];
    expect(ended.type).toBe("deliberation_ended");
  });

  it("double failure: both claude and codex error", async () => {
    const events = await collectEvents(
      makeInput({
        adapters: {
          claude: new MockAdapter({ id: "claude", error: "Claude crashed" }),
          codex: new MockAdapter({ id: "codex", error: "Codex crashed" }),
          steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded") }),
        },
      }),
    );

    // Should have 2 agent_error events
    const errors = eventsOfType(events, "agent_error");
    expect(errors).toHaveLength(2);

    // Steward should NOT be called
    const stewardDecisions = eventsOfType(events, "steward_decision");
    expect(stewardDecisions).toHaveLength(0);

    // No steward response_end events
    const stewardResponses = eventsOfType(events, "agent_response_end").filter(
      (e) => e.participant === "steward",
    );
    expect(stewardResponses).toHaveLength(0);

    // Should end with double_failure
    const ended = events[events.length - 1];
    expect(ended.type).toBe("deliberation_ended");
    expect(ended.data.reason).toBe("double_failure");
  });

  it("steward parse failure: steward returns invalid JSON", async () => {
    const events = await collectEvents(
      makeInput({
        adapters: {
          claude: new MockAdapter({ id: "claude", response: "Claude response" }),
          codex: new MockAdapter({ id: "codex", response: "Codex response" }),
          steward: new MockAdapter({ id: "steward", response: "This is not valid JSON at all" }),
        },
      }),
    );

    // Should have a steward_parse_error
    const parseErrors = eventsOfType(events, "steward_parse_error");
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0].participant).toBe("roundtable");

    // Should end with steward_parse_error reason
    const ended = events[events.length - 1];
    expect(ended.type).toBe("deliberation_ended");
    expect(ended.data.reason).toBe("steward_parse_error");
  });

  it("needs_user: steward returns needs_user status", async () => {
    const events = await collectEvents(
      makeInput({
        adapters: {
          claude: new MockAdapter({ id: "claude", response: "Claude response" }),
          codex: new MockAdapter({ id: "codex", response: "Codex response" }),
          steward: new MockAdapter({
            id: "steward",
            response: stewardDecision("needs_user", "Need clarification from user"),
          }),
        },
      }),
    );

    // Should have steward_decision with needs_user
    const stewardDecisions = eventsOfType(events, "steward_decision");
    expect(stewardDecisions).toHaveLength(1);
    expect(stewardDecisions[0].data.status).toBe("needs_user");

    // Should end with needs_user reason
    const ended = events[events.length - 1];
    expect(ended.type).toBe("deliberation_ended");
    expect(ended.data.reason).toBe("needs_user");
  });

  it("emits chunk events during streaming", async () => {
    const events = await collectEvents(
      makeInput({
        adapters: {
          claude: new MockAdapter({ id: "claude", response: "word1 word2 word3", streamChunks: true }),
          codex: new MockAdapter({ id: "codex", response: "Codex response" }),
          steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded") }),
        },
      }),
    );

    const chunks = eventsOfType(events, "agent_chunk");
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].participant).toBe("claude");
  });

  it("handles adapter that throws an exception", async () => {
    const throwingAdapter = new MockAdapter({ id: "claude", response: "ok" });
    // eslint-disable-next-line require-yield
    throwingAdapter.invoke = async function* () {
      throw new Error("Unexpected adapter crash");
    };

    const events = await collectEvents(
      makeInput({
        adapters: {
          claude: throwingAdapter,
          codex: new MockAdapter({ id: "codex", response: "Codex works" }),
          steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded") }),
        },
      }),
    );

    // Should capture the thrown error as an agent_error
    const errors = eventsOfType(events, "agent_error");
    expect(errors).toHaveLength(1);
    expect(errors[0].participant).toBe("roundtable");
    expect(errors[0].data.error).toContain("Unexpected adapter crash");

    // Codex still runs, steward still decides
    const codexResponses = eventsOfType(events, "agent_response_end").filter(
      (e) => e.participant === "codex",
    );
    expect(codexResponses).toHaveLength(1);

    const ended = events[events.length - 1];
    expect(ended.type).toBe("deliberation_ended");
  });

  it("handles timeout events from adapters", async () => {
    const events = await collectEvents(
      makeInput({
        adapters: {
          claude: new MockAdapter({ id: "claude", timeout: true }),
          codex: new MockAdapter({ id: "codex", response: "Codex works" }),
          steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded") }),
        },
      }),
    );

    // Timeout should be emitted as agent_invocation_timeout
    const timeouts = eventsOfType(events, "agent_invocation_timeout");
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0].participant).toBe("roundtable");

    // Should still continue with codex and steward
    const codexResponses = eventsOfType(events, "agent_response_end").filter(
      (e) => e.participant === "codex",
    );
    expect(codexResponses).toHaveLength(1);

    const ended = events[events.length - 1];
    expect(ended.type).toBe("deliberation_ended");
  });

  it("sets contextPackId on events", async () => {
    const events = await collectEvents(makeInput());

    // deliberation_started and onward should have contextPackId
    const delStarted = eventsOfType(events, "deliberation_started")[0];
    expect(delStarted.contextPackId).toBe("ctx_test001");
    expect(delStarted.data.contextPackId).toBe("ctx_test001");
  });

  it("user_message event has correct participant and content", async () => {
    const events = await collectEvents(makeInput());
    const userMsg = eventsOfType(events, "user_message")[0];
    expect(userMsg.participant).toBe("user");
    expect(userMsg.data.content).toBe("Please refactor the auth module.");
  });
});
