import { describe, it, expect, beforeEach } from "vitest";
import { RoundtableEngine, deriveSessionTitle } from "../engine.js";
import { TestAdapter } from "./test-adapter.js";
import { InMemorySessionStore } from "./in-memory-session-store.js";
import { randomUUID } from "node:crypto";
import type { RoundtableConfig, ContextPack, SessionEvent } from "../types.js";

function makeConfig(): RoundtableConfig {
  return {
    dataDir: "/tmp/roundtable-test",
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
    claude: new TestAdapter({ id: "claude", response: "Claude's thoughtful analysis." }),
    codex: new TestAdapter({ id: "codex", response: "Codex's code suggestion." }),
    steward: new TestAdapter({ id: "steward", response: stewardDecision("concluded") }),
  };
}

describe("RoundtableEngine", () => {
  let store: InMemorySessionStore;
  let engine: RoundtableEngine;

  beforeEach(() => {
    store = new InMemorySessionStore();
    engine = new RoundtableEngine({
      store,
      adapters: makeMockAdapters(),
      config: makeConfig(),
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

      // Check each participant has artifact files
      for (const participant of ["claude", "codex", "steward"]) {
        const artifacts = store.listArtifacts(session.meta.id, participant);

        const metaFiles = artifacts.filter((a) => a.endsWith("meta.json"));
        const stdoutFiles = artifacts.filter((a) => a.endsWith("stdout.log"));
        expect(metaFiles.length).toBeGreaterThanOrEqual(1);
        expect(stdoutFiles.length).toBeGreaterThanOrEqual(1);

        // Verify meta.json content
        const invocationId = metaFiles[0].split("/")[0];
        const metaContent = JSON.parse(
          store.getArtifact(session.meta.id, participant, invocationId, "meta.json")!,
        );
        expect(metaContent.invocationId).toBeDefined();
        expect(metaContent.command).toBeDefined();
        expect(metaContent.exitCode).toBe(0);
        expect(metaContent.durationMs).toBeDefined();

        // Verify stdout.log content
        const stdout = store.getArtifact(session.meta.id, participant, invocationId, "stdout.log")!;
        expect(stdout.length).toBeGreaterThan(0);
      }
    });

    it("saves meta.json with error for error invocations", async () => {
      const errorEngine = new RoundtableEngine({
        store,
        adapters: {
          claude: new TestAdapter({ id: "claude", error: "Claude process crashed" }),
          codex: new TestAdapter({ id: "codex", response: "Codex works fine" }),
          steward: new TestAdapter({ id: "steward", response: stewardDecision("concluded") }),
        },
        config: makeConfig(),
      });

      const cp = mockContextPack();
      const session = await errorEngine.startSession("/tmp/test-project", cp);

      const events: SessionEvent[] = [];
      for await (const event of errorEngine.submitMessage(session, "Do something.")) {
        events.push(event);
      }

      // Claude errored — should have meta.json with error
      const claudeArtifacts = store.listArtifacts(session.meta.id, "claude");
      const claudeMetaFiles = claudeArtifacts.filter((a) => a.endsWith("meta.json"));
      expect(claudeMetaFiles.length).toBe(1);

      const invocationId = claudeMetaFiles[0].split("/")[0];
      const claudeMeta = JSON.parse(
        store.getArtifact(session.meta.id, "claude", invocationId, "meta.json")!,
      );
      expect(claudeMeta.error).toContain("Claude process crashed");

      // Codex succeeded — should have stdout.log
      const codexArtifacts = store.listArtifacts(session.meta.id, "codex");
      expect(codexArtifacts.filter((a) => a.endsWith("stdout.log")).length).toBe(1);
    });

    it("saves meta.json for timeout invocations", async () => {
      const timeoutEngine = new RoundtableEngine({
        store,
        adapters: {
          claude: new TestAdapter({ id: "claude", timeout: true }),
          codex: new TestAdapter({ id: "codex", response: "Codex works" }),
          steward: new TestAdapter({ id: "steward", response: stewardDecision("concluded") }),
        },
        config: makeConfig(),
      });

      const cp = mockContextPack();
      const session = await timeoutEngine.startSession("/tmp/test-project", cp);

      await drain(timeoutEngine.submitMessage(session, "Do something."));

      const claudeArtifacts = store.listArtifacts(session.meta.id, "claude");
      const metaFiles = claudeArtifacts.filter((a) => a.endsWith("meta.json"));
      expect(metaFiles.length).toBe(1);

      const invocationId = metaFiles[0].split("/")[0];
      const meta = JSON.parse(
        store.getArtifact(session.meta.id, "claude", invocationId, "meta.json")!,
      );
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
      const agentEvents = events.filter(
        (e) => e.type.startsWith("agent_") || e.type === "output_truncated",
      );
      for (const event of agentEvents) {
        expect(event.data.invocationId).toBeDefined();
        expect(event.data.invocationId).toMatch(/^inv_/);
      }
    });
  });

  describe("session titles", () => {
    it("sets title from first user message", async () => {
      const cp = mockContextPack();
      const session = await engine.startSession("/tmp/test-project", cp);

      expect(session.meta.title).toBeUndefined();

      await drain(engine.submitMessage(session, "Review the auth module"));

      const meta = await store.loadSession(session.meta.id);
      expect(meta.title).toBe("Review the auth module");
    });

    it("does not overwrite title on subsequent messages", async () => {
      const cp = mockContextPack();
      const session = await engine.startSession("/tmp/test-project", cp);

      await drain(engine.submitMessage(session, "First question"));
      await drain(engine.submitMessage(session, "Second question"));

      const meta = await store.loadSession(session.meta.id);
      expect(meta.title).toBe("First question");
    });

    it("preserves existing title on resumed sessions", async () => {
      const cp = mockContextPack();
      const session = await engine.startSession("/tmp/test-project", cp);

      await drain(engine.submitMessage(session, "Original title message"));

      // Resume session
      const resumed = await engine.resumeSession(session.meta.id);
      await drain(engine.submitMessage(resumed, "Follow-up message"));

      const meta = await store.loadSession(session.meta.id);
      expect(meta.title).toBe("Original title message");
    });

    it("keeps (untitled) for empty messages", async () => {
      const cp = mockContextPack();
      const session = await engine.startSession("/tmp/test-project", cp);

      await drain(engine.submitMessage(session, "   "));

      const meta = await store.loadSession(session.meta.id);
      expect(meta.title).toBeUndefined();
    });
  });

  describe("session cleanup on failure", () => {
    it("returns to awaiting_user when adapter throws mid-invocation", async () => {
      const throwingAdapter = new TestAdapter({ id: "claude", response: "ok" });
      // eslint-disable-next-line require-yield
      throwingAdapter.invoke = async function* () {
        throw new Error("Adapter crashed unexpectedly");
      };

      const errorEngine = new RoundtableEngine({
        store,
        adapters: {
          claude: throwingAdapter,
          codex: new TestAdapter({ id: "codex", response: "Codex works" }),
          steward: new TestAdapter({ id: "steward", response: stewardDecision("concluded") }),
        },
        config: makeConfig(),
      });

      const cp = mockContextPack();
      const session = await errorEngine.startSession("/tmp/test-project", cp);
      await drain(errorEngine.submitMessage(session, "test"));

      // invokeAdapter catches the throw and converts to agent_error;
      // the turn-loop handles single failures gracefully
      const meta = await store.loadSession(session.meta.id);
      expect(meta.status).toBe("awaiting_user");
    });

    it("returns to awaiting_user on abort", async () => {
      const controller = new AbortController();
      controller.abort();

      const cp = mockContextPack();
      const session = await engine.startSession("/tmp/test-project", cp);
      await drain(engine.submitMessage(session, "test", controller.signal));

      const meta = await store.loadSession(session.meta.id);
      expect(meta.status).toBe("awaiting_user");

      // Should have a deliberation_interrupted event
      const stored = await store.loadEvents(session.meta.id);
      expect(stored.some((e) => e.type === "deliberation_interrupted")).toBe(true);
    });

    it("continues deliberation when saveArtifact throws", async () => {
      const failStore = new FailingSessionStore();
      failStore.failSaveArtifact = true;

      const artifactEngine = new RoundtableEngine({
        store: failStore,
        adapters: makeMockAdapters(),
        config: makeConfig(),
      });

      const cp = mockContextPack();
      const session = await artifactEngine.startSession("/tmp/test-project", cp);

      // Should NOT throw — artifacts are best-effort
      await drain(artifactEngine.submitMessage(session, "test"));

      const meta = await failStore.loadSession(session.meta.id);
      expect(meta.status).toBe("awaiting_user");

      // Deliberation should have completed normally
      const events = await failStore.loadEvents(session.meta.id);
      const ended = events.filter((e) => e.type === "deliberation_ended");
      expect(ended).toHaveLength(1);
      expect(ended[0].data.reason).toBe("concluded");
    });

    it("resets status when appendEvent throws mid-deliberation", async () => {
      const failStore = new FailingSessionStore();
      // Fail when the first agent_invocation_started event is appended
      failStore.failAppendOnType = "agent_invocation_started";

      const appendEngine = new RoundtableEngine({
        store: failStore,
        adapters: makeMockAdapters(),
        config: makeConfig(),
      });

      const cp = mockContextPack();
      const session = await appendEngine.startSession("/tmp/test-project", cp);

      await expect(drain(appendEngine.submitMessage(session, "test"))).rejects.toThrow(
        "Simulated appendEvent failure",
      );

      // Session must NOT be stuck in "deliberating"
      const meta = await failStore.loadSession(session.meta.id);
      expect(meta.status).toBe("awaiting_user");

      // Events written before the failure should be preserved
      const events = await failStore.loadEvents(session.meta.id);
      expect(events.some((e) => e.type === "user_message")).toBe(true);
      expect(events.some((e) => e.type === "deliberation_started")).toBe(true);
    });

    it("preserves events for transcript generation after mid-deliberation failure", async () => {
      // Markdown export (generateTranscriptMarkdown) reads from persisted events.
      // Verify that events written before a failure are intact and usable.
      const failStore = new FailingSessionStore();
      failStore.failAppendOnType = "agent_response_end";

      const mdEngine = new RoundtableEngine({
        store: failStore,
        adapters: makeMockAdapters(),
        config: makeConfig(),
      });

      const cp = mockContextPack();
      const session = await mdEngine.startSession("/tmp/test-project", cp);

      try {
        await drain(mdEngine.submitMessage(session, "Review code"));
      } catch {
        // expected
      }

      const meta = await failStore.loadSession(session.meta.id);
      expect(meta.status).toBe("awaiting_user");

      // Events before the failure are in the store
      const events = await failStore.loadEvents(session.meta.id);
      const userMsg = events.find((e) => e.type === "user_message");
      expect(userMsg).toBeDefined();
      expect(userMsg!.data.content).toBe("Review code");

      // Invocation lifecycle events written before response_end are preserved
      expect(events.some((e) => e.type === "agent_invocation_started")).toBe(true);
    });
  });
});

/**
 * InMemorySessionStore subclass that can simulate failures
 * on specific operations for testing cleanup paths.
 */
class FailingSessionStore extends InMemorySessionStore {
  failAppendOnType?: string;
  failSaveArtifact = false;

  async appendEvent(sessionId: string, event: SessionEvent): Promise<void> {
    if (this.failAppendOnType === event.type) {
      throw new Error(`Simulated appendEvent failure on ${event.type}`);
    }
    return super.appendEvent(sessionId, event);
  }

  async saveArtifact(
    sessionId: string,
    participant: string,
    invocationId: string,
    filename: string,
    content: string,
  ): Promise<void> {
    if (this.failSaveArtifact) {
      throw new Error("Simulated saveArtifact failure");
    }
    return super.saveArtifact(sessionId, participant, invocationId, filename, content);
  }
}

describe("deriveSessionTitle", () => {
  it("returns short messages as-is", () => {
    expect(deriveSessionTitle("Review the auth module")).toBe("Review the auth module");
  });

  it("returns undefined for empty input", () => {
    expect(deriveSessionTitle("")).toBeUndefined();
    expect(deriveSessionTitle("   ")).toBeUndefined();
    expect(deriveSessionTitle("\n\t")).toBeUndefined();
  });

  it("collapses internal whitespace", () => {
    expect(deriveSessionTitle("hello   world\nfoo")).toBe("hello world foo");
  });

  it("returns exactly 80-char messages without truncation", () => {
    const msg = "a".repeat(40) + " " + "b".repeat(39); // 80 chars
    expect(deriveSessionTitle(msg)).toBe(msg);
    expect(deriveSessionTitle(msg)!.length).toBe(80);
  });

  it("truncates long messages at word boundary with ellipsis", () => {
    const msg =
      "Can you inspect the current context builder behavior and tell me whether docs are still outranking implementation source files?";
    const title = deriveSessionTitle(msg)!;
    expect(title).toMatch(/\.\.\.$/);
    // Text before "..." should be at most 80 chars
    const textPart = title.slice(0, -3);
    expect(textPart.length).toBeLessThanOrEqual(80);
    // Should end at a complete word, not mid-word
    expect(textPart).toBe(
      "Can you inspect the current context builder behavior and tell me whether docs",
    );
  });

  it("truncates at limit when no word boundary exists", () => {
    const msg = "a".repeat(100); // no spaces
    const title = deriveSessionTitle(msg)!;
    expect(title).toBe("a".repeat(80) + "...");
  });
});
