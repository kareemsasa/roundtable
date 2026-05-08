import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StewardAdapter } from "../steward-claude.js";
import type { AgentEvent, AgentInput, ContextPack, AdapterConfig } from "@roundtable/core";
import { StewardDecisionSchema } from "@roundtable/core";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ── Helpers ──────────────────────────────────────────────────────

async function collectEvents(iter: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iter) events.push(event);
  return events;
}

/** Create a fake "steward" executable that reads stdin and writes a fixed response */
async function createFakeSteward(dir: string, response: string): Promise<string> {
  const scriptPath = join(dir, "fake-steward");
  const script = `#!/usr/bin/env node
// Read stdin (ignore it) and write the response
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(${JSON.stringify(response)});
});
`;
  await writeFile(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

/** Create a fake steward that captures stdin to a file and writes a response */
async function createFakeStewardCapture(
  dir: string,
  response: string,
  captureFile: string,
): Promise<string> {
  const scriptPath = join(dir, "fake-steward-capture");
  const script = `#!/usr/bin/env node
const fs = require("fs");
const chunks = [];
process.stdin.on("data", d => chunks.push(d));
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(captureFile)}, Buffer.concat(chunks).toString());
  process.stdout.write(${JSON.stringify(response)});
});
`;
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
    systemPrompt: "You are the Steward, a moderator in a roundtable deliberation.",
    deliberationId: "delib-001",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("StewardAdapter", () => {
  let tmpBase: string;

  beforeEach(async () => {
    tmpBase = join(tmpdir(), `roundtable-steward-test-${randomUUID()}`);
    await mkdir(tmpBase, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  });

  it('valid "concluded" decision', async () => {
    const decision = JSON.stringify({
      status: "concluded",
      reason: "Consensus reached",
      summary: "Both agree.",
    });
    const fakeCmd = await createFakeSteward(tmpBase, decision);
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new StewardAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);
    const events = await collectEvents(adapter.invoke(makeAgentInput()));

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      const parsed = JSON.parse(responseEnd.content);
      const validated = StewardDecisionSchema.safeParse(parsed);
      expect(validated.success).toBe(true);
      if (validated.success) {
        expect(validated.data.status).toBe("concluded");
        expect(validated.data.reason).toBe("Consensus reached");
        expect(validated.data.summary).toBe("Both agree.");
      }
    }
  });

  it('valid "continue" decision', async () => {
    const decision = JSON.stringify({
      status: "continue",
      reason: "More discussion needed",
      summary: "Partial agreement.",
    });
    const fakeCmd = await createFakeSteward(tmpBase, decision);
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new StewardAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);
    const events = await collectEvents(adapter.invoke(makeAgentInput()));

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      const parsed = JSON.parse(responseEnd.content);
      const validated = StewardDecisionSchema.safeParse(parsed);
      expect(validated.success).toBe(true);
      if (validated.success) {
        expect(validated.data.status).toBe("continue");
      }
    }
  });

  it('valid "needs_user" decision', async () => {
    const decision = JSON.stringify({
      status: "needs_user",
      reason: "Clarification needed",
      summary: "User input required.",
    });
    const fakeCmd = await createFakeSteward(tmpBase, decision);
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new StewardAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);
    const events = await collectEvents(adapter.invoke(makeAgentInput()));

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      const parsed = JSON.parse(responseEnd.content);
      const validated = StewardDecisionSchema.safeParse(parsed);
      expect(validated.success).toBe(true);
      if (validated.success) {
        expect(validated.data.status).toBe("needs_user");
      }
    }
  });

  it("strips markdown code fences", async () => {
    const wrappedResponse = '```json\n{"status":"concluded","reason":"done","summary":"ok"}\n```';
    const fakeCmd = await createFakeSteward(tmpBase, wrappedResponse);
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new StewardAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);
    const events = await collectEvents(adapter.invoke(makeAgentInput()));

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      // Should not contain code fence markers
      expect(responseEnd.content).not.toContain("```");
      // Should be valid JSON
      const parsed = JSON.parse(responseEnd.content);
      expect(parsed.status).toBe("concluded");
    }
  });

  it("invalid JSON — non-JSON text is passed through", async () => {
    const rawText = "I think the team should refactor the auth module.";
    const fakeCmd = await createFakeSteward(tmpBase, rawText);
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new StewardAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);
    const events = await collectEvents(adapter.invoke(makeAgentInput()));

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      // Adapter should not error, just pass through the text
      expect(responseEnd.content).toBe(rawText);
    }
  });

  it("valid JSON but invalid schema — adapter still yields response_end", async () => {
    const invalidSchema = JSON.stringify({ status: "unknown", foo: "bar" });
    const fakeCmd = await createFakeSteward(tmpBase, invalidSchema);
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new StewardAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);
    const events = await collectEvents(adapter.invoke(makeAgentInput()));

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      // Adapter does not validate schema — just passes through
      const parsed = JSON.parse(responseEnd.content);
      expect(parsed.status).toBe("unknown");
      // Zod validation would fail (turn loop responsibility)
      const validated = StewardDecisionSchema.safeParse(parsed);
      expect(validated.success).toBe(false);
    }
  });

  it("args do not include --bare", async () => {
    const decision = JSON.stringify({
      status: "concluded",
      reason: "done",
      summary: "ok",
    });
    const fakeCmd = await createFakeSteward(tmpBase, decision);
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new StewardAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);
    const events = await collectEvents(adapter.invoke(makeAgentInput()));

    const metadata = events.find((e) => e.type === "invocation_metadata");
    expect(metadata).toBeDefined();
    if (metadata?.type === "invocation_metadata") {
      expect(metadata.args).not.toContain("--bare");
      expect(metadata.args).toContain("--print");
      expect(metadata.args).toContain("--no-session-persistence");
      expect(metadata.args).toContain("--permission-mode");
      expect(metadata.args).toContain("--tools");
    }
  });

  it("auth error stdout does not emit chunks (no speech leak)", async () => {
    const scriptPath = join(tmpBase, "fake-steward-auth-leak");
    const script = `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write("Not logged in \\u00b7 Please run /login");
});
`;
    await writeFile(scriptPath, script, { mode: 0o755 });

    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new StewardAdapter(makeAdapterConfig({ command: scriptPath }), dataDir);
    const events = await collectEvents(adapter.invoke(makeAgentInput()));

    // Should have an error event
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.error).toContain("authentication required");
    }

    // Should NOT have any stdout chunks (auth text must not render as speech)
    const stdoutChunks = events.filter((e) => e.type === "chunk" && e.stream === "stdout");
    expect(stdoutChunks).toHaveLength(0);
  });

  it("detects 'Not logged in' as auth error", async () => {
    const scriptPath = join(tmpBase, "fake-steward-auth-error");
    const script = `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write("Not logged in \\u00b7 Please run /login");
});
`;
    await writeFile(scriptPath, script, { mode: 0o755 });

    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new StewardAdapter(makeAdapterConfig({ command: scriptPath }), dataDir);
    const events = await collectEvents(adapter.invoke(makeAgentInput()));

    // Should NOT have response_end
    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeUndefined();

    // Should have error event
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.error).toContain("authentication required");
      expect(errorEvent.exitCode).toBe(0);
      expect(errorEvent.stderr).toContain("Not logged in");
    }
  });

  it("non-zero exit yields error event", async () => {
    const scriptPath = join(tmpBase, "fake-steward-error");
    const script = `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  process.stderr.write("Steward CLI error: model unavailable");
  process.exit(1);
});
`;
    await writeFile(scriptPath, script, { mode: 0o755 });

    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new StewardAdapter(makeAdapterConfig({ command: scriptPath }), dataDir);
    const events = await collectEvents(adapter.invoke(makeAgentInput()));

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.stderr).toContain("model unavailable");
      expect(errorEvent.exitCode).toBe(1);
    }
  });

  it("prompt includes JSON schema instructions", async () => {
    const decision = JSON.stringify({
      status: "concluded",
      reason: "done",
      summary: "ok",
    });
    const captureFile = join(tmpBase, "captured-stdin.txt");
    const fakeCmd = await createFakeStewardCapture(tmpBase, decision, captureFile);
    const dataDir = join(tmpBase, "data");
    await mkdir(dataDir, { recursive: true });

    const adapter = new StewardAdapter(makeAdapterConfig({ command: fakeCmd }), dataDir);
    const input = makeAgentInput({
      transcript: [
        {
          participant: "claude",
          content: "I suggest we refactor the module.",
          timestamp: "2026-05-07T00:00:00Z",
        },
        {
          participant: "codex",
          content: "I agree with the refactoring approach.",
          timestamp: "2026-05-07T00:00:01Z",
        },
      ],
    });
    await collectEvents(adapter.invoke(input));

    const { readFile } = await import("node:fs/promises");
    const captured = await readFile(captureFile, "utf-8");

    // Should contain JSON instruction text
    expect(captured).toContain("Respond ONLY with a JSON object");
    // Should contain context pack heading
    expect(captured).toContain("# Context Pack");
    // Should contain transcript
    expect(captured).toContain("# Transcript");
    expect(captured).toContain("claude: I suggest we refactor the module.");
    expect(captured).toContain("codex: I agree with the refactoring approach.");
    // Should contain schema description
    expect(captured).toContain('"status"');
    expect(captured).toContain("concluded");
  });
});
