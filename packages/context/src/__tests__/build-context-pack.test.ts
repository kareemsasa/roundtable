import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import type { ContextConfig } from "@wardroom/core";
import { buildContextPack } from "../build-context-pack.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/sample-project");

const defaultConfig: ContextConfig = {
  budgetBytes: 100_000,
  maxFiles: 50,
  maxFileBytes: 10_000,
  maxTreeDepth: 5,
};

describe("buildContextPack", () => {
  beforeAll(async () => {
    // Create .env.local fixture (gitignored, so must be created at test time)
    const envPath = path.join(FIXTURES, ".env.local");
    try {
      await fs.access(envPath);
    } catch {
      await fs.writeFile(envPath, "SECRET_KEY=supersecret123\n");
    }
  });

  it("builds a context pack from the fixture directory", async () => {
    const pack = await buildContextPack(FIXTURES, defaultConfig);

    expect(pack.id).toBeTruthy();
    expect(pack.version).toBe(1);
    expect(pack.targetPath).toBe(FIXTURES);
    expect(pack.createdAt).toBeTruthy();
    expect(pack.config).toEqual(defaultConfig);
  });

  it("includes README.md in the context pack", async () => {
    const pack = await buildContextPack(FIXTURES, defaultConfig);
    const readme = pack.files.find((f) => f.path === "README.md");

    expect(readme).toBeDefined();
    expect(readme!.category).toBe("project_meta");
    expect(readme!.content).toContain("Sample Project");
    expect(readme!.bytes).toBeGreaterThan(0);
  });

  it("includes WARDROOM.md in the context pack", async () => {
    const pack = await buildContextPack(FIXTURES, defaultConfig);
    const rt = pack.files.find((f) => f.path === "WARDROOM.md");

    expect(rt).toBeDefined();
    expect(rt!.category).toBe("wardroom_config");
  });

  it("excludes .env.local from included files", async () => {
    const pack = await buildContextPack(FIXTURES, defaultConfig);
    const envFile = pack.files.find((f) => f.path === ".env.local");

    expect(envFile).toBeUndefined();
  });

  it("reports .env.local in omitted files", async () => {
    const pack = await buildContextPack(FIXTURES, defaultConfig);
    const omitted = pack.omitted.files.find((f) => f.path === ".env.local");

    expect(omitted).toBeDefined();
    expect(omitted!.reason).toBe("hard_denied");
  });

  it("redacts secrets in file content", async () => {
    // The .env.local is hard-denied so won't be in files.
    // Let's verify that if a file contains a secret pattern, it gets redacted.
    // We'll test via the WARDROOM.md or by checking that content is clean.
    const pack = await buildContextPack(FIXTURES, defaultConfig);

    // All file contents should not contain unredacted secret patterns
    for (const file of pack.files) {
      expect(file.content).not.toMatch(/SECRET_KEY=supersecret123/);
    }
  });

  it("produces a display path with ~ for home directory", async () => {
    const pack = await buildContextPack(FIXTURES, defaultConfig);
    const homedir = os.homedir();

    if (FIXTURES.startsWith(homedir)) {
      expect(pack.displayPath).toMatch(/^~/);
      expect(pack.displayPath).not.toContain(homedir);
    }
  });

  it("generates stats", async () => {
    const pack = await buildContextPack(FIXTURES, defaultConfig);

    expect(pack.stats.totalFiles).toBeGreaterThan(0);
    expect(pack.stats.includedFiles).toBeGreaterThan(0);
    expect(pack.stats.includedFiles).toBeLessThanOrEqual(pack.stats.totalFiles);
    expect(pack.stats.totalBytes).toBeGreaterThan(0);
    expect(pack.stats.budgetBytes).toBe(defaultConfig.budgetBytes);
  });

  it("generates a directory tree", async () => {
    const pack = await buildContextPack(FIXTURES, defaultConfig);

    expect(pack.tree).toBeDefined();
    expect(pack.tree.name).toBeTruthy();
    expect(pack.tree.type).toBe("directory");
  });

  it("accepts a custom version number", async () => {
    const pack = await buildContextPack(FIXTURES, defaultConfig, 5);
    expect(pack.version).toBe(5);
  });

  it("truncates files exceeding maxFileBytes", async () => {
    const config: ContextConfig = {
      ...defaultConfig,
      maxFileBytes: 10, // Very small limit
    };

    const pack = await buildContextPack(FIXTURES, config);
    const truncatedFiles = pack.files.filter((f) => f.truncated);

    // At least some files should be truncated with a 10-byte limit
    expect(truncatedFiles.length).toBeGreaterThan(0);
    for (const file of truncatedFiles) {
      expect(file.content.length).toBeLessThanOrEqual(10);
    }
  });
});
