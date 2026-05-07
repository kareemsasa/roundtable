import { describe, it, expect } from "vitest";
import path from "node:path";
import { scanFolder } from "../scan-folder.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/sample-project");

describe("scanFolder", () => {
  it("returns all files in the fixture directory", async () => {
    const files = await scanFolder(FIXTURES);
    const relativePaths = files.map((f) => f.relativePath).sort();

    expect(relativePaths).toContain("README.md");
    expect(relativePaths).toContain("package.json");
    expect(relativePaths).toContain("src/index.ts");
    expect(relativePaths).toContain(".env.local");
    expect(relativePaths).toContain("docs/guide.md");
    expect(relativePaths).toContain("ROUNDTABLE.md");
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
