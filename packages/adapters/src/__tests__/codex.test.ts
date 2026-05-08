import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CodexAdapter } from "../codex.js";
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

/** Create a fake "codex" executable (Node script) with configurable behavior */
async function createFakeCodex(dir: string, behavior: "echo" | "error" | "hang"): Promise<string> {
  const scriptPath = join(dir, "fake-codex");
  let script: string;

  if (behavior === "echo") {
    script = `#!/usr/bin/env node
const chunks = [];
process.stdin.on("data", d => chunks.push(d));
process.stdin.on("end", () => {
  process.stdout.write("Codex response based on: " + Buffer.concat(chunks).toString().slice(0, 80));
});
`;
  } else if (behavior === "error") {
    script = `#!/usr/bin/env node
process.stderr.write("codex error: authentication failed");
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
    command: "codex",
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

describe("CodexAdapter", () => {
  let tmpBase: string;

  beforeEach(async () => {
    tmpBase = join(tmpdir(), `roundtable-codex-test-${randomUUID()}`);
    await mkdir(tmpBase, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  });

  it("args include expected Codex flags", async () => {
    const fakeCmd = await createFakeCodex(tmpBase, "echo");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new CodexAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    const metadata = events.find((e) => e.type === "invocation_metadata");
    expect(metadata).toBeDefined();
    if (metadata?.type === "invocation_metadata") {
      expect(metadata.args).toContain("exec");
      expect(metadata.args).toContain("--sandbox");
      expect(metadata.args).toContain("read-only");
      expect(metadata.args).toContain("--ephemeral");
      expect(metadata.args).toContain("--ignore-user-config");
      expect(metadata.args).toContain("--ignore-rules");
      expect(metadata.args).toContain("--skip-git-repo-check");
      expect(metadata.args).toContain("--cd");
      expect(metadata.args).toContain("-");
    }
  });

  it("prompt includes system prompt as instructions, context pack, and transcript", async () => {
    // Use a fake codex that echoes full stdin (more chars to verify content)
    const scriptPath = join(tmpBase, "fake-codex-full");
    const script = `#!/usr/bin/env node
const chunks = [];
process.stdin.on("data", d => chunks.push(d));
process.stdin.on("end", () => {
  process.stdout.write(Buffer.concat(chunks).toString());
});
`;
    await writeFile(scriptPath, script, { mode: 0o755 });

    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new CodexAdapter(makeAdapterConfig({ command: scriptPath }), dataDir);

    const input = makeAgentInput({
      systemPrompt: "You are a deliberation participant.",
      transcript: [
        {
          participant: "user",
          content: "What does this code do?",
          timestamp: "2026-05-07T00:00:00Z",
        },
        {
          participant: "claude",
          content: "It logs hello.",
          timestamp: "2026-05-07T00:00:01Z",
        },
      ],
    });

    const events = await collectEvents(adapter.invoke(input));

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      // System prompt is included as "# Instructions" section (not a CLI flag)
      expect(responseEnd.content).toContain("# Instructions");
      expect(responseEnd.content).toContain("You are a deliberation participant.");
      expect(responseEnd.content).toContain("# Context Pack");
      expect(responseEnd.content).toContain("# Transcript");
      expect(responseEnd.content).toContain("user: What does this code do?");
      expect(responseEnd.content).toContain("claude: It logs hello.");
    }
  });

  it("temp cwd is used (not target folder)", async () => {
    const fakeCmd = await createFakeCodex(tmpBase, "echo");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new CodexAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const invocationId = randomUUID();
    const input = makeAgentInput({ invocationId });
    const events = await collectEvents(adapter.invoke(input));

    const metadata = events.find((e) => e.type === "invocation_metadata");
    expect(metadata).toBeDefined();
    if (metadata?.type === "invocation_metadata") {
      // cwd should be under dataDir/tmp, not the target path
      expect(metadata.cwd).toContain(join(dataDir, "tmp"));
      expect(metadata.cwd).toContain(invocationId);
      expect(metadata.cwd).not.toBe("/home/user/project");
    }
  });

  it("successful response from fake codex", async () => {
    const fakeCmd = await createFakeCodex(tmpBase, "echo");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new CodexAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    // Should have invocation_started
    const started = events.find((e) => e.type === "invocation_started");
    expect(started).toBeDefined();
    expect(started!.type === "invocation_started" && started!.pid).toBeGreaterThan(0);

    // Should have invocation_metadata
    const metadata = events.find((e) => e.type === "invocation_metadata");
    expect(metadata).toBeDefined();

    // Should have response_end with content from the fake codex
    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      expect(responseEnd.content).toContain("Codex response based on:");
      expect(responseEnd.exitCode).toBe(0);
      expect(responseEnd.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("stderr capture on error", async () => {
    const fakeCmd = await createFakeCodex(tmpBase, "error");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new CodexAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.stderr).toContain("authentication failed");
      expect(errorEvent.exitCode).toBe(1);
    }
  });

  it("non-zero exit code", async () => {
    // Create a fake codex that exits with code 42
    const scriptPath = join(tmpBase, "fake-codex-exit42");
    const script = `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  process.stderr.write("codex: internal error");
  process.exit(42);
});
`;
    await writeFile(scriptPath, script, { mode: 0o755 });

    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new CodexAdapter(makeAdapterConfig({ command: scriptPath }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.exitCode).toBe(42);
    }
  });

  it("missing binary produces error event", async () => {
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new CodexAdapter(
      makeAdapterConfig({ command: "/nonexistent/path/codex-fake" }),
      dataDir,
    );

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.error).toBeTruthy();
    }
  });

  it("timeout: fake codex hangs", async () => {
    const fakeCmd = await createFakeCodex(tmpBase, "hang");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new CodexAdapter(
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

  it("args include --json flag", async () => {
    const fakeCmd = await createFakeCodex(tmpBase, "echo");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new CodexAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    const metadata = events.find((e) => e.type === "invocation_metadata");
    expect(metadata).toBeDefined();
    if (metadata?.type === "invocation_metadata") {
      expect(metadata.args).toContain("--json");
    }
  });

  it("extracts response from --json JSONL output", async () => {
    const jsonOutput = [
      '{"type":"thread.started","thread_id":"test-123"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"The answer is 42"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":5}}',
    ].join("\n");

    const scriptPath = join(tmpBase, "fake-codex-jsonl");
    const script = `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(${JSON.stringify(jsonOutput)});
});
`;
    await writeFile(scriptPath, script, { mode: 0o755 });

    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new CodexAdapter(makeAdapterConfig({ command: scriptPath }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      expect(responseEnd.content).toBe("The answer is 42");
      expect(responseEnd.content).not.toContain("item.completed");
    }
  });

  it("concatenates multiple item.completed texts", async () => {
    const jsonOutput = [
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"First part"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Second part"}}',
    ].join("\n");

    const scriptPath = join(tmpBase, "fake-codex-multi");
    const script = `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(${JSON.stringify(jsonOutput)});
});
`;
    await writeFile(scriptPath, script, { mode: 0o755 });

    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new CodexAdapter(makeAdapterConfig({ command: scriptPath }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      expect(responseEnd.content).toBe("First part\nSecond part");
    }
  });

  it("falls back to raw output if no item.completed events found", async () => {
    const rawText = "Just some plain text response";

    const scriptPath = join(tmpBase, "fake-codex-raw");
    const script = `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(${JSON.stringify(rawText)});
});
`;
    await writeFile(scriptPath, script, { mode: 0o755 });

    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new CodexAdapter(makeAdapterConfig({ command: scriptPath }), dataDir);

    const input = makeAgentInput();
    const events = await collectEvents(adapter.invoke(input));

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      expect(responseEnd.content).toBe(rawText);
    }
  });

  it("temp cwd is created and cleaned up", async () => {
    const fakeCmd = await createFakeCodex(tmpBase, "echo");
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new CodexAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);

    const invocationId = randomUUID();
    const input = makeAgentInput({ invocationId });
    const expectedTmpDir = join(dataDir, "tmp", invocationId);

    // Consume all events
    await collectEvents(adapter.invoke(input));

    // After invoke completes, the temp dir should be cleaned up
    await expect(stat(expectedTmpDir)).rejects.toThrow();
  });
});
