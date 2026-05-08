import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SessionEvent } from "@roundtable/core";
import { renderEvent, resetRenderer, type RenderOptions } from "../render.js";

function makeEvent(
  type: SessionEvent["type"],
  participant: SessionEvent["participant"],
  data: Record<string, unknown>,
): SessionEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    timestamp: new Date().toISOString(),
    sessionId: "sess_001",
    participant,
    data,
  };
}

describe("renderEvent", () => {
  let stdoutChunks: string[];
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    resetRenderer();
    stdoutChunks = [];
    originalWrite = process.stdout.write;
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  function rendered(): string {
    return stdoutChunks.join("");
  }

  const streamOpts: RenderOptions = { verbose: false, stream: true };
  const nonStreamOpts: RenderOptions = { verbose: false, stream: false };

  it("suppresses steward agent_chunk events during streaming", () => {
    const chunk = makeEvent("agent_chunk", "steward", {
      content: '{"status":"concluded"',
      stream: "stdout",
    });
    renderEvent(chunk, streamOpts);
    expect(rendered()).toBe("");
  });

  it("renders non-steward agent_chunk events during streaming", () => {
    const chunk = makeEvent("agent_chunk", "claude", {
      content: "Hello from Claude",
      stream: "stdout",
    });
    renderEvent(chunk, streamOpts);
    expect(rendered()).toContain("Claude");
    expect(rendered()).toContain("Hello from Claude");
  });

  it("suppresses steward agent_response_end", () => {
    const event = makeEvent("agent_response_end", "steward", {
      content: '{"status":"concluded","reason":"done","summary":"All good"}',
    });
    renderEvent(event, nonStreamOpts);
    expect(rendered()).toBe("");
  });

  it("renders steward_decision summary", () => {
    const event = makeEvent("steward_decision", "steward", {
      status: "concluded",
      reason: "done",
      summary: "All good",
    });
    renderEvent(event, nonStreamOpts);
    expect(rendered()).toContain("Steward");
    expect(rendered()).toContain("All good");
    expect(rendered()).not.toContain('"status"');
  });

  it("shows steward exactly once for a full steward event sequence", () => {
    const events: SessionEvent[] = [
      makeEvent("agent_chunk", "steward", { content: '{"status":', stream: "stdout" }),
      makeEvent("agent_chunk", "steward", { content: '"concluded"}', stream: "stdout" }),
      makeEvent("agent_response_end", "steward", {
        content: '{"status":"concluded","reason":"done","summary":"Consensus reached"}',
      }),
      makeEvent("steward_decision", "steward", {
        status: "concluded",
        reason: "done",
        summary: "Consensus reached",
      }),
    ];

    for (const event of events) {
      renderEvent(event, streamOpts);
    }

    const output = rendered();
    const stewardMatches = output.match(/Steward/g) ?? [];
    expect(stewardMatches).toHaveLength(1);
    expect(output).toContain("Consensus reached");
    expect(output).not.toContain('"status"');
    expect(output).not.toContain('"concluded"');
  });
});
