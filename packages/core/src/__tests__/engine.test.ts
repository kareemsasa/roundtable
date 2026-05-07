import { describe, it, expect, beforeEach } from "vitest";
import { RoundtableEngine } from "../engine.js";
import { MockAdapter } from "@roundtable/adapters";
import { FileSessionStore } from "@roundtable/persistence";
import { mkdir } from "node:fs/promises";
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
      claude: { command: "claude", mode: "mock", limits: { invocationTimeoutMs: 120_000, maxOutputBytes: 512_000, gracefulShutdownMs: 5_000 } },
      codex: { command: "codex", mode: "mock", limits: { invocationTimeoutMs: 120_000, maxOutputBytes: 512_000, gracefulShutdownMs: 5_000 } },
      steward: { command: "claude", mode: "mock", limits: { invocationTimeoutMs: 120_000, maxOutputBytes: 512_000, gracefulShutdownMs: 5_000 } },
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

function stewardDecision(status: "concluded" | "continue" | "needs_user", summary = "Test summary"): string {
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
});
