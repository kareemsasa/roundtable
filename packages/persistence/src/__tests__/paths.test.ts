import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  sessionsRoot,
  sessionDir,
  eventsPath,
  metaPath,
  contextPackPath,
  contextPackMdPath,
  artifactPath,
  transcriptPath,
  stewardSummaryPath,
  tmpDir,
} from "../paths.js";

const DATA = "/data";

describe("paths", () => {
  it("sessionsRoot returns dataDir/sessions", () => {
    expect(sessionsRoot(DATA)).toBe(join(DATA, "sessions"));
  });

  it("sessionDir returns dataDir/sessions/<id>", () => {
    expect(sessionDir(DATA, "s1")).toBe(join(DATA, "sessions", "s1"));
  });

  it("eventsPath returns events.jsonl inside session dir", () => {
    expect(eventsPath(DATA, "s1")).toBe(join(DATA, "sessions", "s1", "events.jsonl"));
  });

  it("metaPath returns meta.json inside session dir", () => {
    expect(metaPath(DATA, "s1")).toBe(join(DATA, "sessions", "s1", "meta.json"));
  });

  it("contextPackPath returns context-packs/<id>.json", () => {
    expect(contextPackPath(DATA, "s1", "cp1")).toBe(
      join(DATA, "sessions", "s1", "context-packs", "cp1.json"),
    );
  });

  it("contextPackMdPath returns context-packs/<id>.md", () => {
    expect(contextPackMdPath(DATA, "s1", "cp1")).toBe(
      join(DATA, "sessions", "s1", "context-packs", "cp1.md"),
    );
  });

  it("artifactPath returns artifacts/<participant>/<invocationId>.<filename>", () => {
    expect(artifactPath(DATA, "s1", "claude", "inv1", "output.txt")).toBe(
      join(DATA, "sessions", "s1", "artifacts", "claude", "inv1.output.txt"),
    );
  });

  it("transcriptPath returns transcript.md inside session dir", () => {
    expect(transcriptPath(DATA, "s1")).toBe(join(DATA, "sessions", "s1", "transcript.md"));
  });

  it("stewardSummaryPath returns steward-summary.md inside session dir", () => {
    expect(stewardSummaryPath(DATA, "s1")).toBe(join(DATA, "sessions", "s1", "steward-summary.md"));
  });

  it("tmpDir returns dataDir/tmp/<invocationId>", () => {
    expect(tmpDir(DATA, "inv42")).toBe(join(DATA, "tmp", "inv42"));
  });
});
