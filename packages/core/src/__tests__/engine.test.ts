import { describe, it, expect, beforeEach } from "vitest";
import { RoundtableEngine } from "../engine.js";
import { MockAdapter } from "@roundtable/adapters";
import { FileSessionStore } from "@roundtable/persistence";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { RoundtableConfig, ContextPack, SessionEvent } from "../types.js";

function makeConfig(dataDir: string): RoundtableConfig {
  return {
    dataDir,
    context: { budgetBytes: 100_000, maxFiles: 50, maxFileBytes: 10_000, maxTreeDepth: 5 },
    deliberation: { maxRounds: 2, participantTimeoutMs: 120_000, deliberationTimeoutMs: 600_000 },
    adapters: {
      claude: {
        command: "claude",
        mode: "mock",
        limits: {
          invocationTimeoutMs: 120_000,
          maxOutputBytes: 512_000,
          gracefulShutdownMs: 5_000,
        },
      },
      codex: {
        command: "codex",
        mode: "mock",
        limits: {
          invocationTimeoutMs: 120_000,
          maxOutputBytes: 512_000,
          gracefulShutdownMs: 5_000,
        },
      },
      steward: {
        command: "claude",
        mode: "mock",
        limits: {
          invocationTimeoutMs: 120_000,
          maxOutputBytes: 512_000,
          gracefulShutdownMs: 5_000,
        },
      },
    },
  };
}

function mockContextPack(): ContextPack {
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

async function drain(gen: AsyncGenerator<SessionEvent>): Promise<void> {
  for await (const event of gen) {
    void event;
  }
}

function makeMockAdapters() {
  return {
    claude: new MockAdapter({ id: "claude", response: "Claude's thoughtful analysis." }),
    codex: new MockAdapter({ id: "codex", response: "Codex's code suggestion." }),
    steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded") }),
  };
}

describe("RoundtableEngine", () => {
  let dataDir: string;
  let store: FileSessionStore;
  let engine: RoundtableEngine;

  beforeEach(async () => {
    dataDir = join(tmpdir(), `roundtable-test-${randomUUID()}`);
    await mkdir(dataDir, { recursive: true });
    store = new FileSessionStore(dataDir);
    engine = new RoundtableEngine({
      store,
      adapters: makeMockAdapters(),
      config: makeConfig(dataDir),
    });
  });

  it("startSession creates session and emits lifecycle events", async () => {
    const cp = mockContextPack();
    const session = await engine.startSession("/tmp/test-project", cp);

    expect(session.meta.status).toBe("awaiting_user");
    expect(session.meta.id).toMatch(/^rt_/);
    expect(session.meta.targetPath).toBe("/tmp/test-project");
    expect(session.meta.currentContextPackId).toBe(cp.id);
    expect(session.events).toHaveLength(2);
    expect(session.events[0].type).toBe("session_started");
    expect(session.events[1].type).toBe("context_pack_built");

    // Verify data on session_started event
    expect(session.events[0].data.targetPath).toBe("/tmp/test-project");
    expect(session.events[0].data.contextPackId).toBe(cp.id);

    // Verify data on context_pack_built event
    expect(session.events[1].data.contextPackId).toBe(cp.id);
    expect(session.events[1].data.version).toBe(1);
    expect(session.events[1].data.fileCount).toBe(0);
    expect(session.events[1].data.totalBytes).toBe(0);
  });

  it("submitMessage runs deliberation and persists events", async () => {
    const cp = mockContextPack();
    const session = await engine.startSession("/tmp/test-project", cp);

    const events: SessionEvent[] = [];
    for await (const event of engine.submitMessage(session, "Please review the code.")) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain("user_message");
    expect(types).toContain("deliberation_started");
    expect(types).toContain("agent_response_end");
    expect(types).toContain("steward_decision");
    expect(types).toContain("deliberation_ended");

    // Reload events from store and verify persistence
    const storedEvents = await store.loadEvents(session.meta.id);
    // Stored events include lifecycle events (session_started, context_pack_built) plus deliberation events
    const deliberationEvents = storedEvents.filter(
      (e) => e.type !== "session_started" && e.type !== "context_pack_built",
    );
    expect(deliberationEvents.length).toBe(events.length);
  });

  it("submitMessage updates meta with steward summary", async () => {
    const cp = mockContextPack();
    const session = await engine.startSession("/tmp/test-project", cp);

    // Drain the generator
    await drain(engine.submitMessage(session, "Analyze this."));

    // Reload meta from store
    const meta = await store.loadSession(session.meta.id);
    expect(meta.latestStewardSummary).toBe("Test summary");
    expect(meta.status).toBe("awaiting_user");
  });

  it("resumeSession loads session with events", async () => {
    const cp = mockContextPack();
    const session = await engine.startSession("/tmp/test-project", cp);

    // Run a deliberation
    await drain(engine.submitMessage(session, "Do something."));

    // Resume session
    const resumed = await engine.resumeSession(session.meta.id);
    expect(resumed.meta.id).toBe(session.meta.id);
    expect(resumed.meta.targetPath).toBe("/tmp/test-project");
    expect(resumed.events.length).toBe(session.events.length);
    // Events include lifecycle + deliberation events
    expect(resumed.events.length).toBeGreaterThan(2);
  });

  it("archiveSession emits event and updates status", async () => {
    const cp = mockContextPack();
    const session = await engine.startSession("/tmp/test-project", cp);

    await engine.archiveSession(session);

    // Reload and verify
    const meta = await store.loadSession(session.meta.id);
    expect(meta.status).toBe("archived");

    const storedEvents = await store.loadEvents(session.meta.id);
    const archivedEvents = storedEvents.filter((e) => e.type === "session_archived");
    expect(archivedEvents).toHaveLength(1);
  });

  it("refreshContext saves new pack and emits event", async () => {
    const cp1 = mockContextPack();
    const session = await engine.startSession("/tmp/test-project", cp1);

    const cp2 = mockContextPack();
    cp2.version = 2;
    const returned = await engine.refreshContext(session, cp2);

    expect(returned.id).toBe(cp2.id);
    expect(session.meta.currentContextPackId).toBe(cp2.id);

    // Should have a context_pack_built event for the refresh
    const cpEvents = session.events.filter((e) => e.type === "context_pack_built");
    expect(cpEvents).toHaveLength(2); // one from startSession, one from refreshContext
    expect(cpEvents[1].data.contextPackId).toBe(cp2.id);
    expect(cpEvents[1].data.version).toBe(2);

    // Verify context pack can be loaded from store
    const loaded = await store.loadContextPack(session.meta.id, cp2.id);
    expect(loaded.id).toBe(cp2.id);
  });

  describe("artifact persistence", () => {
    it("saves stdout.log and meta.json for each successful invocation", async () => {
      const cp = mockContextPack();
      const session = await engine.startSession("/tmp/test-project", cp);

      const events: SessionEvent[] = [];
      for await (const event of engine.submitMessage(session, "Review the code.")) {
        events.push(event);
      }

      // Find invocationIds from agent_response_end events
      const responseEnds = events.filter((e) => e.type === "agent_response_end");
      expect(responseEnds.length).toBeGreaterThanOrEqual(3); // claude + codex + steward

      const artifactsRoot = join(dataDir, "sessions", session.meta.id, "artifacts");

      // Check each participant has artifact files
      for (const participant of ["claude", "codex", "steward"]) {
        const participantDir = join(artifactsRoot, participant);
        const files = await readdir(participantDir);

        // Should have at least meta.json and stdout.log
        const metaFiles = files.filter((f) => f.endsWith(".meta.json"));
        const stdoutFiles = files.filter((f) => f.endsWith(".stdout.log"));
        expect(metaFiles.length).toBeGreaterThanOrEqual(1);
        expect(stdoutFiles.length).toBeGreaterThanOrEqual(1);

        // Verify meta.json content
        const metaContent = JSON.parse(await readFile(join(participantDir, metaFiles[0]), "utf-8"));
        expect(metaContent.invocationId).toBeDefined();
        expect(metaContent.command).toBeDefined();
        expect(metaContent.exitCode).toBe(0);
        expect(metaContent.durationMs).toBeDefined();

        // Verify stdout.log content
        const stdout = await readFile(join(participantDir, stdoutFiles[0]), "utf-8");
        expect(stdout.length).toBeGreaterThan(0);
      }
    });

    it("saves stderr.log and meta.json for error invocations", async () => {
      const errorEngine = new RoundtableEngine({
        store,
        adapters: {
          claude: new MockAdapter({ id: "claude", error: "Claude process crashed" }),
          codex: new MockAdapter({ id: "codex", response: "Codex works fine" }),
          steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded") }),
        },
        config: makeConfig(dataDir),
      });

      const cp = mockContextPack();
      const session = await errorEngine.startSession("/tmp/test-project", cp);

      const events: SessionEvent[] = [];
      for await (const event of errorEngine.submitMessage(session, "Do something.")) {
        events.push(event);
      }

      const artifactsRoot = join(dataDir, "sessions", session.meta.id, "artifacts");

      // Claude errored — should have meta.json with error
      const claudeDir = join(artifactsRoot, "claude");
      const claudeFiles = await readdir(claudeDir);
      const claudeMetaFiles = claudeFiles.filter((f) => f.endsWith(".meta.json"));
      expect(claudeMetaFiles.length).toBe(1);

      const claudeMeta = JSON.parse(await readFile(join(claudeDir, claudeMetaFiles[0]), "utf-8"));
      expect(claudeMeta.error).toContain("Claude process crashed");

      // Codex succeeded — should have stdout.log
      const codexDir = join(artifactsRoot, "codex");
      const codexFiles = await readdir(codexDir);
      expect(codexFiles.filter((f) => f.endsWith(".stdout.log")).length).toBe(1);
    });

    it("saves meta.json for timeout invocations", async () => {
      const timeoutEngine = new RoundtableEngine({
        store,
        adapters: {
          claude: new MockAdapter({ id: "claude", timeout: true }),
          codex: new MockAdapter({ id: "codex", response: "Codex works" }),
          steward: new MockAdapter({ id: "steward", response: stewardDecision("concluded") }),
        },
        config: makeConfig(dataDir),
      });

      const cp = mockContextPack();
      const session = await timeoutEngine.startSession("/tmp/test-project", cp);

      await drain(timeoutEngine.submitMessage(session, "Do something."));

      const claudeDir = join(dataDir, "sessions", session.meta.id, "artifacts", "claude");
      const claudeFiles = await readdir(claudeDir);
      const metaFiles = claudeFiles.filter((f) => f.endsWith(".meta.json"));
      expect(metaFiles.length).toBe(1);

      const meta = JSON.parse(await readFile(join(claudeDir, metaFiles[0]), "utf-8"));
      expect(meta.timeout).toBe(true);
      expect(meta.durationMs).toBeDefined();
    });

    it("includes invocationId in session event data", async () => {
      const cp = mockContextPack();
      const session = await engine.startSession("/tmp/test-project", cp);

      const events: SessionEvent[] = [];
      for await (const event of engine.submitMessage(session, "Check this.")) {
        events.push(event);
      }

      // All agent events should have invocationId in data
      const agentEvents = events.filter((e) =>
        e.type.startsWith("agent_") || e.type === "output_truncated",
      );
      for (const event of agentEvents) {
        expect(event.data.invocationId).toBeDefined();
        expect(event.data.invocationId).toMatch(/^inv_/);
      }
    });
  });
});
