import { describe, it, expect } from "vitest";
import { MockAdapter } from "../mock.js";
import type { AgentInput, AgentEvent, ContextPack } from "@roundtable/core";

function makeInput(overrides?: Partial<AgentInput>): AgentInput {
  return {
    invocationId: "inv_001",
    contextPack: { id: "cp_001" } as ContextPack,
    transcript: [],
    systemPrompt: "You are Claude.",
    deliberationId: "del_001",
    ...overrides,
  };
}

async function collectEvents(iter: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iter) {
    events.push(event);
  }
  return events;
}

describe("MockAdapter", () => {
  it("emits invocation_started then response_end with correct content", async () => {
    const adapter = new MockAdapter({ id: "claude", response: "Hello from Claude!" });
    const events = await collectEvents(adapter.invoke(makeInput()));

    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[0].type).toBe("invocation_started");
    expect(events[1].type).toBe("invocation_metadata");

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    expect(responseEnd!.type).toBe("response_end");
    if (responseEnd!.type === "response_end") {
      expect(responseEnd!.content).toBe("Hello from Claude!");
      expect(responseEnd!.exitCode).toBe(0);
      expect(responseEnd!.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("emits chunk events before response_end when streamChunks is true", async () => {
    const adapter = new MockAdapter({
      id: "claude",
      response: "one two three",
      streamChunks: true,
    });
    const events = await collectEvents(adapter.invoke(makeInput()));

    const chunks = events.filter((e) => e.type === "chunk");
    expect(chunks.length).toBe(3);
    expect(chunks.map((c) => (c as Extract<AgentEvent, { type: "chunk" }>).content)).toEqual([
      "one ",
      "two ",
      "three ",
    ]);

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd!.type === "response_end") {
      expect(responseEnd!.content).toBe("one two three");
    }
  });

  it("emits error event with correct message and exitCode when error is set", async () => {
    const adapter = new MockAdapter({ id: "claude", error: "Something went wrong" });
    const events = await collectEvents(adapter.invoke(makeInput()));

    expect(events.length).toBe(3);
    expect(events[0].type).toBe("invocation_started");
    expect(events[1].type).toBe("invocation_metadata");
    expect(events[2].type).toBe("error");

    const errorEvent = events[2];
    if (errorEvent.type === "error") {
      expect(errorEvent.error).toBe("Something went wrong");
      expect(errorEvent.exitCode).toBe(1);
    }
  });

  it("emits timeout event when timeout is true", async () => {
    const adapter = new MockAdapter({ id: "claude", timeout: true });
    const events = await collectEvents(adapter.invoke(makeInput()));

    expect(events.length).toBe(3);
    expect(events[0].type).toBe("invocation_started");
    expect(events[1].type).toBe("invocation_metadata");
    expect(events[2].type).toBe("timeout");

    const timeoutEvent = events[2];
    if (timeoutEvent.type === "timeout") {
      expect(timeoutEvent.durationMs).toBe(120000);
      expect(timeoutEvent.killed).toBe(true);
    }
  });

  it("can parse a StewardDecision from mock response", async () => {
    const decision = {
      status: "concluded" as const,
      reason: "Both agents agree on the approach",
      summary: "Use the adapter pattern for extensibility",
      decisionPoint: "Architecture choice",
      recommendedActions: ["Refactor auth module", "Add unit tests"],
      nextSpeakerHint: "claude" as const,
    };

    const adapter = new MockAdapter({
      id: "steward",
      response: JSON.stringify(decision),
    });
    const events = await collectEvents(adapter.invoke(makeInput()));

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd!.type === "response_end") {
      const parsed = JSON.parse(responseEnd!.content);
      expect(parsed.status).toBe("concluded");
      expect(parsed.reason).toBe("Both agents agree on the approach");
      expect(parsed.summary).toBe("Use the adapter pattern for extensibility");
      expect(parsed.decisionPoint).toBe("Architecture choice");
      expect(parsed.recommendedActions).toEqual(["Refactor auth module", "Add unit tests"]);
      expect(parsed.nextSpeakerHint).toBe("claude");
    }
  });

  it("exposes the configured id", () => {
    const adapter = new MockAdapter({ id: "codex", response: "hi" });
    expect(adapter.id).toBe("codex");
  });

  it("yields timeout when signal is already aborted", async () => {
    const adapter = new MockAdapter({ id: "claude", response: "Hello", delayMs: 100 });
    const controller = new AbortController();
    controller.abort();

    const events = await collectEvents(adapter.invoke(makeInput(), controller.signal));

    const timeoutEvent = events.find((e) => e.type === "timeout");
    expect(timeoutEvent).toBeDefined();
    if (timeoutEvent!.type === "timeout") {
      expect(timeoutEvent!.killed).toBe(true);
    }
  });
});
