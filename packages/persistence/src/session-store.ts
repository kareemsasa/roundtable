import type { SessionMeta, SessionEvent, SessionStore, ContextPack } from "@roundtable/core";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appendJsonl, readJsonl } from "./jsonl.js";
import { sessionDir, sessionsRoot, eventsPath, metaPath, contextPackPath, artifactPath } from "./paths.js";

export class FileSessionStore implements SessionStore {
  constructor(private dataDir: string) {}

  async createSession(meta: SessionMeta): Promise<void> {
    const dir = sessionDir(this.dataDir, meta.id);
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, "context-packs"), { recursive: true });
    await mkdir(join(dir, "artifacts"), { recursive: true });
    await writeFile(metaPath(this.dataDir, meta.id), JSON.stringify(meta, null, 2), "utf-8");
    await writeFile(eventsPath(this.dataDir, meta.id), "", "utf-8");
  }

  async loadSession(sessionId: string): Promise<SessionMeta> {
    const raw = await readFile(metaPath(this.dataDir, sessionId), "utf-8");
    return JSON.parse(raw) as SessionMeta;
  }

  async updateMeta(sessionId: string, updates: Partial<SessionMeta>): Promise<void> {
    const current = await this.loadSession(sessionId);
    const updated = { ...current, ...updates };
    await writeFile(
      metaPath(this.dataDir, sessionId),
      JSON.stringify(updated, null, 2),
      "utf-8",
    );
  }

  async appendEvent(sessionId: string, event: SessionEvent): Promise<void> {
    await appendJsonl(eventsPath(this.dataDir, sessionId), event);
  }

  async loadEvents(sessionId: string): Promise<SessionEvent[]> {
    return readJsonl<SessionEvent>(eventsPath(this.dataDir, sessionId));
  }

  async listSessions(): Promise<SessionMeta[]> {
    const root = sessionsRoot(this.dataDir);
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      return [];
    }
    const sessions: SessionMeta[] = [];
    for (const entry of entries) {
      try {
        sessions.push(await this.loadSession(entry));
      } catch {
        /* skip corrupt */
      }
    }
    return sessions;
  }

  async saveContextPack(sessionId: string, pack: ContextPack): Promise<void> {
    const jsonPath = contextPackPath(this.dataDir, sessionId, pack.id);
    await mkdir(dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, JSON.stringify(pack, null, 2), "utf-8");
  }

  async loadContextPack(sessionId: string, contextPackId: string): Promise<ContextPack> {
    const raw = await readFile(
      contextPackPath(this.dataDir, sessionId, contextPackId),
      "utf-8",
    );
    return JSON.parse(raw) as ContextPack;
  }

  async saveArtifact(
    sessionId: string,
    participant: string,
    invocationId: string,
    filename: string,
    content: string,
  ): Promise<void> {
    const path = artifactPath(this.dataDir, sessionId, participant, invocationId, filename);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf-8");
  }
}
