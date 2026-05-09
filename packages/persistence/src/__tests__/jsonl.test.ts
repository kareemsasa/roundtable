import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { mkdir, rm, readFile } from "node:fs/promises";
import { appendJsonl, readJsonl } from "../jsonl.js";

describe("jsonl", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `wardroom-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("appends a single record and reads it back", async () => {
    const filePath = join(testDir, "test.jsonl");
    await appendJsonl(filePath, { id: 1, name: "first" });
    const records = await readJsonl<{ id: number; name: string }>(filePath);
    expect(records).toEqual([{ id: 1, name: "first" }]);
  });

  it("appends multiple records and reads them all back", async () => {
    const filePath = join(testDir, "test.jsonl");
    await appendJsonl(filePath, { id: 1 });
    await appendJsonl(filePath, { id: 2 });
    await appendJsonl(filePath, { id: 3 });
    const records = await readJsonl<{ id: number }>(filePath);
    expect(records).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("returns empty array for missing file", async () => {
    const filePath = join(testDir, "nonexistent.jsonl");
    const records = await readJsonl(filePath);
    expect(records).toEqual([]);
  });

  it("writes one JSON object per line", async () => {
    const filePath = join(testDir, "test.jsonl");
    await appendJsonl(filePath, { a: 1 });
    await appendJsonl(filePath, { b: 2 });
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ a: 1 });
    expect(JSON.parse(lines[1])).toEqual({ b: 2 });
  });

  it("creates parent directories if they do not exist", async () => {
    const filePath = join(testDir, "nested", "deep", "test.jsonl");
    await appendJsonl(filePath, { nested: true });
    const records = await readJsonl(filePath);
    expect(records).toEqual([{ nested: true }]);
  });
});
