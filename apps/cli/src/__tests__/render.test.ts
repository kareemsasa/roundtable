import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SessionEvent } from "@wardroom/core";
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
  let stderrChunks: string[];
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    resetRenderer();
    stdoutChunks = [];
    stderrChunks = [];
    originalStdoutWrite = process.stdout.write;
    originalStderrWrite = process.stderr.write;
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = vi.fn((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  function rendered(): string {
    return stdoutChunks.join("");
  }

  function renderedStderr(): string {
    return stderrChunks.join("");
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

  it("streaming: response_end displays full content when no chunks were streamed", () => {
    // Codex suppresses JSONL chunks — response_end should fall back to full display
    const claudeChunk = makeEvent("agent_chunk", "claude", {
      content: "Hello from Claude",
      stream: "stdout",
    });
    const claudeEnd = makeEvent("agent_response_end", "claude", {
      content: "Hello from Claude",
    });
    const codexEnd = makeEvent("agent_response_end", "codex", {
      content: "Hello from Codex",
    });

    renderEvent(claudeChunk, streamOpts);
    renderEvent(claudeEnd, streamOpts);
    renderEvent(codexEnd, streamOpts);

    const output = rendered();
    // Claude streamed chunks → response_end just adds newline
    expect(output).toContain("Claude: Hello from Claude");
    // Codex had no chunks → response_end renders full content with header
    expect(output).toContain("Codex: Hello from Codex");
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

  describe("output_truncated warnings", () => {
    const truncatedEvent = makeEvent("output_truncated", "claude", {
      stream: "stdout",
      originalBytes: 640000,
      keptBytes: 524288,
    });

    it("renders truncation warning with stream and byte counts", () => {
      renderEvent(truncatedEvent, streamOpts);
      const output = renderedStderr();
      expect(output).toContain("Wardroom [warning]");
      expect(output).toContain("stdout");
      expect(output).toContain("524288");
      expect(output).toContain("640000");
    });

    it("includes participant name in warning", () => {
      renderEvent(truncatedEvent, streamOpts);
      const output = renderedStderr();
      expect(output).toContain("Claude");
    });

    it("does not render as participant speech on stdout", () => {
      renderEvent(truncatedEvent, streamOpts);
      // Warning goes to stderr, not stdout — should not appear as participant speech
      expect(rendered()).toBe("");
      expect(renderedStderr()).toContain("Wardroom [warning]");
    });

    it("renders warning in --no-stream mode", () => {
      renderEvent(truncatedEvent, nonStreamOpts);
      const output = renderedStderr();
      expect(output).toContain("Wardroom [warning]");
      expect(output).toContain("truncated");
      expect(output).toContain("524288");
    });

    it("renders generic warning when participant is not set", () => {
      const noParticipant = makeEvent("output_truncated", undefined, {
        stream: "stderr",
        originalBytes: 100000,
        keptBytes: 50000,
      });
      renderEvent(noParticipant, streamOpts);
      const output = renderedStderr();
      expect(output).toContain("Wardroom [warning]");
      expect(output).toContain("stderr");
      expect(output).not.toContain("Claude");
      expect(output).not.toContain("Codex");
    });
  });
});
