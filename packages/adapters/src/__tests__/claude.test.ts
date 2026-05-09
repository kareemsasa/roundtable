import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ClaudeAdapter } from "../claude.js";
import type { AgentEvent, AgentInput, ContextPack, AdapterConfig } from "@roundtable/core";
import { mkdir, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ── Helpers ──────────────────────────────────────────────────────

async function collectEvents(iter: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iter) events.push(event);
  return events;
}

/** Create a fake "claude" executable (Node script) with configurable behavior */
async function createFakeClaude(
  dir: string,
  behavior: "echo" | "error" | "hang" | "auth-error" | "rate-limit",
): Promise<string> {
  const scriptPath = join(dir, `fake-claude-${behavior}`);
  let script: string;

  if (behavior === "echo") {
    // Emits stream-json JSONL with the echoed input as a text delta
    script = `#!/usr/bin/env node
const chunks = [];
process.stdin.on("data", d => chunks.push(d));
process.stdin.on("end", () => {
  const input = Buffer.concat(chunks).toString().slice(0, 100);
  const response = "Claude response based on: " + input;
  const lines = [
    JSON.stringify({type: "system", subtype: "init", cwd: "/tmp"}),
    JSON.stringify({type: "stream_event", event: {type: "content_block_delta", index: 0, delta: {type: "text_delta", text: response}}}),
    JSON.stringify({type: "result", subtype: "success", is_error: false, result: response}),
  ];
  process.stdout.write(lines.join("\\n") + "\\n");
});
`;
  } else if (behavior === "error") {
    script = `#!/usr/bin/env node
process.stderr.write("Claude CLI error: not authenticated");
process.exit(1);
`;
  } else if (behavior === "auth-error") {
    // Emits a result event with auth error text
    script = `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  const lines = [
    JSON.stringify({type: "result", subtype: "error", is_error: true, result: "Not logged in \\u00b7 Please run /login"}),
  ];
  process.stdout.write(lines.join("\\n") + "\\n");
});
`;
  } else if (behavior === "rate-limit") {
    script = `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  const lines = [
    JSON.stringify({type: "result", subtype: "error", is_error: true, result: "Error: rate limit exceeded, please try again later"}),
  ];
  process.stdout.write(lines.join("\\n") + "\\n");
});
`;
  } else {
    // hang — for timeout testing
    script = `#!/usr/bin/env node
setTimeout(() => {}, 60000);
`;
  }

  await writeFile(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

function makeContextPack(overrides?: Partial<ContextPack>): ContextPack {
  return {
    id: "cp-001",
    version: 1,
    targetPath: "/home/user/project",
    displayPath: "~/project",
    createdAt: "2026-05-07T00:00:00Z",
    config: {
      budgetBytes: 100_000,
      maxFiles: 50,
      maxFileBytes: 10_000,
      maxTreeDepth: 5,
    },
    tree: { name: "project", type: "directory", children: [] },
    files: [
      {
        path: "src/index.ts",
        category: "source",
        content: 'console.log("hello");',
        bytes: 21,
        truncated: false,
      },
    ],
    omitted: { categories: [], files: [] },
    stats: { totalFiles: 1, includedFiles: 1, totalBytes: 21, budgetBytes: 100_000 },
    ...overrides,
  };
}

function makeAdapterConfig(overrides?: Partial<AdapterConfig>): AdapterConfig {
  return {
    command: "claude",
    mode: "read_only",
    limits: {
      invocationTimeoutMs: 10_000,
      maxOutputBytes: 100_000,
      gracefulShutdownMs: 1_000,
    },
    ...overrides,
  };
}

function makeAgentInput(overrides?: Partial<AgentInput>): AgentInput {
  return {
    invocationId: randomUUID(),
    contextPack: makeContextPack(),
    transcript: [],
    systemPrompt: "You are a helpful assistant in a roundtable deliberation.",
    deliberationId: "delib-001",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("ClaudeAdapter", () => {
  let tmpBase: string;

  beforeEach(async () => {
    tmpBase = join(tmpdir(), `roundtable-claude-test-${randomUUID()}`);
    await mkdir(tmpBase, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  });

  it("happy path: fake claude echoes stdin-based prompt", async () => {
    const fakeCmd = await createFakeClaude(tmpBase, "echo");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    // Should have invocation_started
    const started = events.find((e) => e.type === "invocation_started");
    expect(started).toBeDefined();
    expect(started!.type === "invocation_started" && started!.pid).toBeGreaterThan(0);

    // Should have invocation_metadata
    const metadata = events.find((e) => e.type === "invocation_metadata");
    expect(metadata).toBeDefined();

    // Should have response_end with clean content (not raw JSONL)
    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      expect(responseEnd.content).toContain("Claude response based on:");
      expect(responseEnd.content).not.toContain("stream_event");
      expect(responseEnd.content).not.toContain("content_block_delta");
      expect(responseEnd.exitCode).toBe(0);
      expect(responseEnd.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("prompt assembly includes context pack and transcript", async () => {
    const fakeCmd = await createFakeClaude(tmpBase, "echo");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const input = makeAgentInput({
      transcript: [
        {
          participant: "user",
          content: "What does this code do?",
          timestamp: "2026-05-07T00:00:00Z",
        },
        { participant: "claude", content: "It logs hello.", timestamp: "2026-05-07T00:00:01Z" },
      ],
    });

    const events = await collectEvents(adapter.invoke(input));

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      // The fake claude echoes back the first 100 chars of stdin
      // which should include parts of the context pack
      expect(responseEnd.content).toContain("Context Pack");
    }
  });

  it("error: fake claude exits non-zero", async () => {
    const fakeCmd = await createFakeClaude(tmpBase, "error");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.stderr).toContain("not authenticated");
      expect(errorEvent.exitCode).toBe(1);
    }
  });

  it("timeout: fake claude hangs", async () => {
    const fakeCmd = await createFakeClaude(tmpBase, "hang");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(
      makeAdapterConfig({
        command: fakeCmd,
        limits: {
          invocationTimeoutMs: 300,
          maxOutputBytes: 100_000,
          gracefulShutdownMs: 200,
        },
      }),
      dataDir,
    );

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    const timeoutEvent = events.find((e) => e.type === "timeout");
    expect(timeoutEvent).toBeDefined();
    if (timeoutEvent?.type === "timeout") {
      expect(timeoutEvent.killed).toBe(true);
      expect(timeoutEvent.durationMs).toBeGreaterThanOrEqual(250);
    }
  }, 10_000);

  it("temp cwd is created and cleaned up", async () => {
    const fakeCmd = await createFakeClaude(tmpBase, "echo");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const invocationId = randomUUID();
    const input = makeAgentInput({ invocationId });
    const expectedTmpDir = join(dataDir, "tmp", invocationId);

    // Consume all events
    await collectEvents(adapter.invoke(input));

    // After invoke completes, the temp dir should be cleaned up
    await expect(stat(expectedTmpDir)).rejects.toThrow();
  });

  it("missing command produces error event", async () => {
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(
      makeAdapterConfig({ command: "/nonexistent/path/claude-fake" }),
      dataDir,
    );

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    // spawnCliAgent should handle the spawn error — expect an error event
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.error).toBeTruthy();
    }
  });

  it("args include expected CLI flags for stream-json", async () => {
    const fakeCmd = await createFakeClaude(tmpBase, "echo");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    const metadata = events.find((e) => e.type === "invocation_metadata");
    expect(metadata).toBeDefined();
    if (metadata?.type === "invocation_metadata") {
      expect(metadata.args).toContain("--print");
      expect(metadata.args).toContain("--no-session-persistence");
      expect(metadata.args).toContain("--permission-mode");
      expect(metadata.args).toContain("plan");
      expect(metadata.args).toContain("--output-format");
      expect(metadata.args).toContain("stream-json");
      expect(metadata.args).toContain("--verbose");
      expect(metadata.args).toContain("--include-partial-messages");
      expect(metadata.args).toContain("--tools");
      expect(metadata.args).toContain("");
      expect(metadata.args).toContain("--system-prompt");
    }
  });

  it("detects 'Not logged in' as auth error", async () => {
    const fakeCmd = await createFakeClaude(tmpBase, "auth-error");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    // Should NOT have a response_end event
    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeUndefined();

    // Should have an error event with auth message
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.error).toContain("authentication required");
      expect(errorEvent.exitCode).toBe(0);
      expect(errorEvent.stderr).toContain("Not logged in");
    }
  });

  it("detects rate limit as error", async () => {
    const fakeCmd = await createFakeClaude(tmpBase, "rate-limit");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeUndefined();

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.error).toContain("rate limit");
      expect(errorEvent.exitCode).toBe(0);
    }
  });

  it("passes through normal responses without error detection", async () => {
    const fakeCmd = await createFakeClaude(tmpBase, "echo");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    // Should have response_end, NOT error
    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeUndefined();
  });

  it("auth error does not emit chunks (no speech leak)", async () => {
    const fakeCmd = await createFakeClaude(tmpBase, "auth-error");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    // Should have an error event
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();

    // Should NOT have any stdout chunks (auth text must not render as speech)
    const stdoutChunks = events.filter((e) => e.type === "chunk" && e.stream === "stdout");
    expect(stdoutChunks).toHaveLength(0);
  });

  it("stream-json text deltas are emitted as incremental chunks", async () => {
    // Fake claude that emits multiple content_block_delta events
    const scriptPath = join(tmpBase, "fake-claude-stream");
    const script = `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  const lines = [
    JSON.stringify({type: "system", subtype: "init"}),
    JSON.stringify({type: "stream_event", event: {type: "content_block_delta", index: 0, delta: {type: "text_delta", text: "Hello "}}}),
    JSON.stringify({type: "stream_event", event: {type: "content_block_delta", index: 0, delta: {type: "text_delta", text: "world"}}}),
    JSON.stringify({type: "stream_event", event: {type: "content_block_delta", index: 0, delta: {type: "text_delta", text: "!"}}}),
    JSON.stringify({type: "result", subtype: "success", is_error: false, result: "Hello world!"}),
  ];
  process.stdout.write(lines.join("\\n") + "\\n");
});
`;
    await writeFile(scriptPath, script, { mode: 0o755 });

    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(makeAdapterConfig({ command: scriptPath }), dataDir);
    const events = await collectEvents(adapter.invoke(makeAgentInput()));

    // Should have 3 chunk events with the delta text
    const chunks = events.filter((e) => e.type === "chunk" && e.stream === "stdout");
    expect(chunks).toHaveLength(3);
    expect(chunks[0].type === "chunk" && chunks[0].content).toBe("Hello ");
    expect(chunks[1].type === "chunk" && chunks[1].content).toBe("world");
    expect(chunks[2].type === "chunk" && chunks[2].content).toBe("!");

    // Should have response_end with clean text
    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      expect(responseEnd.content).toBe("Hello world!");
    }
  });

  it("raw stream-json JSONL does not leak into display", async () => {
    const fakeCmd = await createFakeClaude(tmpBase, "echo");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);
    const events = await collectEvents(adapter.invoke(makeAgentInput()));

    // All chunks should contain clean text, not raw JSONL
    const chunks = events.filter((e) => e.type === "chunk" && e.stream === "stdout");
    for (const chunk of chunks) {
      if (chunk.type === "chunk") {
        expect(chunk.content).not.toContain('"type":"stream_event"');
        expect(chunk.content).not.toContain('"type":"result"');
        expect(chunk.content).not.toContain('"type":"system"');
      }
    }

    // response_end content should be clean text
    const responseEnd = events.find((e) => e.type === "response_end");
    if (responseEnd?.type === "response_end") {
      expect(responseEnd.content).not.toContain('"type":"stream_event"');
      expect(responseEnd.content).not.toContain('"type":"result"');
    }
  });

  it("short clean response still yields chunks", async () => {
    const fakeCmd = await createFakeClaude(tmpBase, "echo");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);
    const events = await collectEvents(adapter.invoke(makeAgentInput()));

    // At least one chunk from the text delta
    const chunks = events.filter((e) => e.type === "chunk" && e.stream === "stdout");
    expect(chunks.length).toBeGreaterThan(0);

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
  });

  it("system prompt is passed via --system-prompt flag", async () => {
    // Use a fake-claude that dumps args to verify
    const scriptPath = join(tmpBase, "fake-claude-args");
    const script = `#!/usr/bin/env node
// Find --system-prompt and output the next arg
const idx = process.argv.indexOf("--system-prompt");
if (idx >= 0 && idx + 1 < process.argv.length) {
  process.stdout.write("SYSTEM_PROMPT=" + process.argv[idx + 1]);
} else {
  process.stdout.write("NO_SYSTEM_PROMPT_FOUND");
}
// drain stdin
process.stdin.resume();
process.stdin.on("end", () => {});
`;
    await writeFile(scriptPath, script, { mode: 0o755 });

    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new ClaudeAdapter(makeAdapterConfig({ command: scriptPath }), dataDir);

    const input = makeAgentInput({ systemPrompt: "Test system prompt" });
    const events = await collectEvents(adapter.invoke(input));

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      expect(responseEnd.content).toContain("SYSTEM_PROMPT=Test system prompt");
    }
  });
});
