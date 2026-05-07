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
async function createFakeClaude(dir: string, behavior: "echo" | "error" | "hang"): Promise<string> {
  const scriptPath = join(dir, "fake-claude");
  let script: string;

  if (behavior === "echo") {
    script = `#!/usr/bin/env node
const chunks = [];
process.stdin.on("data", d => chunks.push(d));
process.stdin.on("end", () => {
  process.stdout.write("Claude response based on: " + Buffer.concat(chunks).toString().slice(0, 100));
});
`;
  } else if (behavior === "error") {
    script = `#!/usr/bin/env node
process.stderr.write("Claude CLI error: not authenticated");
process.exit(1);
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

    // Should have response_end with content from the fake claude
    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      expect(responseEnd.content).toContain("Claude response based on:");
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

  it("args include expected CLI flags", async () => {
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
      expect(metadata.args).toContain("--bare");
      expect(metadata.args).toContain("--no-session-persistence");
      expect(metadata.args).toContain("--permission-mode");
      expect(metadata.args).toContain("plan");
      expect(metadata.args).toContain("--output-format");
      expect(metadata.args).toContain("text");
      expect(metadata.args).toContain("--tools");
      expect(metadata.args).toContain("");
      expect(metadata.args).toContain("--system-prompt");
    }
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
