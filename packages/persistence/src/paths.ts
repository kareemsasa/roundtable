import { join } from "node:path";

export function sessionsRoot(dataDir: string): string {
  return join(dataDir, "sessions");
}

export function sessionDir(dataDir: string, sessionId: string): string {
  return join(sessionsRoot(dataDir), sessionId);
}

export function eventsPath(dataDir: string, sessionId: string): string {
  return join(sessionDir(dataDir, sessionId), "events.jsonl");
}

export function metaPath(dataDir: string, sessionId: string): string {
  return join(sessionDir(dataDir, sessionId), "meta.json");
}

export function contextPackPath(dataDir: string, sessionId: string, contextPackId: string): string {
  return join(sessionDir(dataDir, sessionId), "context-packs", `${contextPackId}.json`);
}

export function contextPackMdPath(
  dataDir: string,
  sessionId: string,
  contextPackId: string,
): string {
  return join(sessionDir(dataDir, sessionId), "context-packs", `${contextPackId}.md`);
}

export function artifactPath(
  dataDir: string,
  sessionId: string,
  participant: string,
  invocationId: string,
  filename: string,
): string {
  return join(
    sessionDir(dataDir, sessionId),
    "artifacts",
    participant,
    `${invocationId}.${filename}`,
  );
}

export function transcriptPath(dataDir: string, sessionId: string): string {
  return join(sessionDir(dataDir, sessionId), "transcript.md");
}

export function stewardSummaryPath(dataDir: string, sessionId: string): string {
  return join(sessionDir(dataDir, sessionId), "steward-summary.md");
}

export function tmpDir(dataDir: string, invocationId: string): string {
  return join(dataDir, "tmp", invocationId);
}
