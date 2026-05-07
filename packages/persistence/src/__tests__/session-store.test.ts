import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { mkdir, rm, readFile, readdir } from "node:fs/promises";
import type { SessionMeta, SessionEvent, ContextPack, ResolvedConfig } from "@roundtable/core";
import { FileSessionStore } from "../session-store.js";

function makeConfig(): ResolvedConfig {
  return {
    dataDir: "/tmp/rt",
    context: {
      budgetBytes: 100_000,
      maxFiles: 50,
      maxFileBytes: 10_000,
      maxTreeDepth: 6,
    },
    deliberation: {
      maxRounds: 2,
      participantTimeoutMs: 60_000,
      deliberationTimeoutMs: 300_000,
    },
    adapters: {
      claude: {
        command: "claude",
        mode: "read_only",
        limits: { invocationTimeoutMs: 60_000, maxOutputBytes: 50_000, gracefulShutdownMs: 5_000 },
      },
      codex: {
        command: "codex",
        mode: "read_only",
        limits: { invocationTimeoutMs: 60_000, maxOutputBytes: 50_000, gracefulShutdownMs: 5_000 },
      },
      steward: {
        command: "claude",
        mode: "read_only",
        limits: { invocationTimeoutMs: 60_000, maxOutputBytes: 50_000, gracefulShutdownMs: 5_000 },
      },
    },
  };
}

function makeMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: overrides.id ?? `sess_${randomUUID()}`,
    status: "awaiting_user",
    targetPath: "/project",
    createdAt: "2026-05-06T12:00:00Z",
    updatedAt: "2026-05-06T12:00:00Z",
    currentContextPackId: "cp1",
    configSnapshot: makeConfig(),
    participants: [
      { id: "claude", adapter: "claude-cli" },
      { id: "codex", adapter: "codex-cli" },
    ],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: overrides.id ?? `evt_${randomUUID()}`,
    type: "user_message",
    timestamp: "2026-05-06T12:00:00Z",
    sessionId: "sess_001",
    participant: "user",
    data: { content: "Hello" },
    ...overrides,
  };
}

function makeContextPack(overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    id: overrides.id ?? `cp_${randomUUID()}`,
    version: 1,
    targetPath: "/project",
    displayPath: "project",
    createdAt: "2026-05-06T12:00:00Z",
    config: {
      budgetBytes: 100_000,
      maxFiles: 50,
      maxFileBytes: 10_000,
      maxTreeDepth: 6,
    },
    tree: { name: "project", type: "directory", children: [] },
    files: [],
    omitted: { categories: [], files: [] },
    stats: { totalFiles: 10, includedFiles: 5, totalBytes: 5000, budgetBytes: 100_000 },
    ...overrides,
  };
}

describe("FileSessionStore", () => {
  let testDir: string;
  let store: FileSessionStore;

  beforeEach(async () => {
    testDir = join(tmpdir(), `roundtable-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    store = new FileSessionStore(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("createSession + loadSession", () => {
    it("creates session directory structure and loads meta back", async () => {
      const meta = makeMeta({ id: "sess_001" });
      await store.createSession(meta);
      const loaded = await store.loadSession("sess_001");
      expect(loaded).toEqual(meta);
    });

    it("creates subdirectories for context-packs and artifacts", async () => {
      const meta = makeMeta({ id: "sess_002" });
      await store.createSession(meta);
      const sessionPath = join(testDir, "sessions", "sess_002");
      const entries = await readdir(sessionPath);
      expect(entries).toContain("context-packs");
      expect(entries).toContain("artifacts");
      expect(entries).toContain("meta.json");
      expect(entries).toContain("events.jsonl");
    });

    it("creates an empty events.jsonl file", async () => {
      const meta = makeMeta({ id: "sess_003" });
      await store.createSession(meta);
      const eventsContent = await readFile(
        join(testDir, "sessions", "sess_003", "events.jsonl"),
        "utf-8",
      );
      expect(eventsContent).toBe("");
    });
  });

  describe("updateMeta", () => {
    it("merges partial updates into existing meta", async () => {
      const meta = makeMeta({ id: "sess_010" });
      await store.createSession(meta);
      await store.updateMeta("sess_010", {
        status: "deliberating",
        updatedAt: "2026-05-06T13:00:00Z",
      });
      const updated = await store.loadSession("sess_010");
      expect(updated.status).toBe("deliberating");
      expect(updated.updatedAt).toBe("2026-05-06T13:00:00Z");
      // Non-updated fields preserved
      expect(updated.targetPath).toBe("/project");
    });
  });

  describe("appendEvent + loadEvents", () => {
    it("appends and loads multiple events in order", async () => {
      const meta = makeMeta({ id: "sess_020" });
      await store.createSession(meta);

      const evt1 = makeEvent({ id: "evt_1", sessionId: "sess_020" });
      const evt2 = makeEvent({
        id: "evt_2",
        sessionId: "sess_020",
        type: "agent_response_end",
        participant: "claude",
        data: { content: "Response" },
      });

      await store.appendEvent("sess_020", evt1);
      await store.appendEvent("sess_020", evt2);

      const events = await store.loadEvents("sess_020");
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(evt1);
      expect(events[1]).toEqual(evt2);
    });

    it("returns empty array for session with no events", async () => {
      const meta = makeMeta({ id: "sess_021" });
      await store.createSession(meta);
      const events = await store.loadEvents("sess_021");
      expect(events).toEqual([]);
    });
  });

  describe("listSessions", () => {
    it("lists all created sessions", async () => {
      await store.createSession(makeMeta({ id: "sess_a" }));
      await store.createSession(makeMeta({ id: "sess_b" }));
      await store.createSession(makeMeta({ id: "sess_c" }));

      const sessions = await store.listSessions();
      const ids = sessions.map((s) => s.id).sort();
      expect(ids).toEqual(["sess_a", "sess_b", "sess_c"]);
    });

    it("returns empty array when no sessions exist", async () => {
      const sessions = await store.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe("saveContextPack + loadContextPack", () => {
    it("saves and loads a context pack", async () => {
      const meta = makeMeta({ id: "sess_030" });
      await store.createSession(meta);

      const pack = makeContextPack({ id: "cp_001" });
      await store.saveContextPack("sess_030", pack);

      const loaded = await store.loadContextPack("sess_030", "cp_001");
      expect(loaded).toEqual(pack);
    });
  });

  describe("saveArtifact", () => {
    it("saves an artifact to the correct path", async () => {
      const meta = makeMeta({ id: "sess_040" });
      await store.createSession(meta);

      await store.saveArtifact("sess_040", "claude", "inv_001", "output.txt", "hello world");

      const artifactContent = await readFile(
        join(testDir, "sessions", "sess_040", "artifacts", "claude", "inv_001.output.txt"),
        "utf-8",
      );
      expect(artifactContent).toBe("hello world");
    });

    it("creates participant subdirectory if needed", async () => {
      const meta = makeMeta({ id: "sess_041" });
      await store.createSession(meta);

      await store.saveArtifact("sess_041", "codex", "inv_002", "result.json", '{"ok":true}');

      const content = await readFile(
        join(testDir, "sessions", "sess_041", "artifacts", "codex", "inv_002.result.json"),
        "utf-8",
      );
      expect(content).toBe('{"ok":true}');
    });
  });
});
