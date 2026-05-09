import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { scanFolder } from "../scan-folder.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/sample-project");

describe("scanFolder", () => {
  beforeAll(async () => {
    // Create .env.local fixture (gitignored, so must be created at test time)
    const envPath = path.join(FIXTURES, ".env.local");
    try {
      await fs.access(envPath);
    } catch {
      await fs.writeFile(envPath, "SECRET_KEY=supersecret123\n");
    }
  });

  it("returns all files in the fixture directory", async () => {
    const files = await scanFolder(FIXTURES);
    const relativePaths = files.map((f) => f.relativePath).sort();

    expect(relativePaths).toContain("README.md");
    expect(relativePaths).toContain("package.json");
    expect(relativePaths).toContain("src/index.ts");
    expect(relativePaths).toContain(".env.local");
    expect(relativePaths).toContain("docs/guide.md");
    expect(relativePaths).toContain("WARDROOM.md");
  });

  it("includes file sizes greater than zero", async () => {
    const files = await scanFolder(FIXTURES);
    for (const file of files) {
      expect(file.bytes).toBeGreaterThan(0);
    }
  });

  it("returns absolute paths that exist", async () => {
    const files = await scanFolder(FIXTURES);
    for (const file of files) {
      expect(path.isAbsolute(file.absolutePath)).toBe(true);
      expect(file.absolutePath).toContain(FIXTURES);
    }
  });

  it("does not include .git directory internals", async () => {
    const files = await scanFolder(FIXTURES);
    const gitFiles = files.filter(
      (f) => f.relativePath.startsWith(".git/") || f.relativePath === ".git",
    );
    expect(gitFiles).toHaveLength(0);
  });
});
