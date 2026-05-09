import { describe, it, expect, beforeEach } from "vitest";
import { WardroomEngine } from "@wardroom/core";
import { MockAdapter } from "@wardroom/adapters";
import { FileSessionStore } from "@wardroom/persistence";
import { buildContextPack } from "@wardroom/context";
import { resolveConfig } from "@wardroom/config";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("acceptance: mock-backed deliberation", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = join(tmpdir(), `rt-acceptance-${randomUUID()}`);
    await mkdir(dataDir, { recursive: true });
  });

  it("runs a full deliberation cycle end-to-end", async () => {
    const config = resolveConfig({ cliOverrides: { dataDir } });
    const store = new FileSessionStore(dataDir);
    const adapters = {
      claude: new MockAdapter({
        id: "claude",
        response: "I recommend focusing on the core module first.",
      }),
      codex: new MockAdapter({
        id: "codex",
        response: "Agreed, the core module is the priority.",
      }),
      steward: new MockAdapter({
        id: "steward",
        response: JSON.stringify({
          status: "concluded",
          reason: "Both participants agree on priorities",
          summary:
            "Consensus: focus on the core module. Both Claude and Codex recommend starting there.",
        }),
      }),
    };

    const engine = new WardroomEngine({ store, adapters, config });

    // Build context pack from fixtures
    const fixturesPath = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "..",
      "packages",
      "context",
      "src",
      "__tests__",
      "fixtures",
      "sample-project",
    );
    const contextPack = await buildContextPack(fixturesPath, config.context);
    expect(contextPack.files.length).toBeGreaterThan(0);

    // Start session
    const session = await engine.startSession(fixturesPath, contextPack);
    expect(session.meta.status).toBe("awaiting_user");
    expect(session.meta.id).toMatch(/^rt_/);

    // Run deliberation
    const events = [];
    for await (const event of engine.submitMessage(session, "What should I work on?")) {
      events.push(event);
    }

    // Verify event sequence
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("user_message");
    expect(types).toContain("deliberation_started");
    expect(types).toContain("agent_response_end");
    expect(types).toContain("steward_decision");
    expect(types).toContain("deliberation_ended");

    // Verify responses
    const claudeResponse = events.find(
      (e) => e.type === "agent_response_end" && e.participant === "claude",
    );
    expect(claudeResponse).toBeDefined();
    expect((claudeResponse!.data as { content: string }).content).toContain("core module");

    // Verify persistence
    const storedEvents = await store.loadEvents(session.meta.id);
    expect(storedEvents.length).toBe(session.events.length);

    // Verify session meta updated
    const meta = await store.loadSession(session.meta.id);
    expect(meta.latestStewardSummary).toContain("Consensus");
    expect(meta.status).toBe("awaiting_user");
  });
});
