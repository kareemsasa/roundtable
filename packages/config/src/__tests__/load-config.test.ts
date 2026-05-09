import { describe, it, expect } from "vitest";
import { resolveConfig } from "../load-config.js";

describe("resolveConfig", () => {
  it("returns defaults when no overrides provided", () => {
    const config = resolveConfig({});
    expect(config.dataDir).toContain("wardroom");
    expect(config.context.budgetBytes).toBe(140_000);
    expect(config.context.maxFiles).toBe(75);
    expect(config.deliberation.maxRounds).toBe(2);
    expect(config.deliberation.maxTranscriptBytes).toBe(131_072);
    expect(config.adapters.claude.command).toBe("claude");
    expect(config.adapters.codex.command).toBe("codex");
    expect(config.adapters.steward.command).toBe("claude");
  });

  it("CLI overrides take precedence over defaults", () => {
    const config = resolveConfig({
      cliOverrides: {
        context: { budgetBytes: 50_000, maxFiles: 25 },
        deliberation: { maxRounds: 1 },
      },
    });
    expect(config.context.budgetBytes).toBe(50_000);
    expect(config.context.maxFiles).toBe(25);
    expect(config.deliberation.maxRounds).toBe(1);
    // Non-overridden values stay at defaults
    expect(config.context.maxFileBytes).toBe(10_000);
  });

  it("respects WARDROOM_HOME env var", () => {
    const config = resolveConfig({
      env: { WARDROOM_HOME: "/tmp/rt-test" },
    });
    expect(config.dataDir).toBe("/tmp/rt-test");
  });

  it("project config overrides global config", () => {
    const config = resolveConfig({
      globalConfig: { context: { budgetBytes: 80_000 } },
      projectConfig: { context: { budgetBytes: 60_000 } },
    });
    expect(config.context.budgetBytes).toBe(60_000);
  });

  it("CLI overrides take precedence over project config", () => {
    const config = resolveConfig({
      projectConfig: { context: { budgetBytes: 60_000 } },
      cliOverrides: { context: { budgetBytes: 40_000 } },
    });
    expect(config.context.budgetBytes).toBe(40_000);
  });
});
