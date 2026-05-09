import type { SessionMeta, SessionEvent, ContextPack, SessionStore } from "../types.js";

/**
 * Minimal in-memory SessionStore for core tests.
 * Avoids a workspace dependency on packages/persistence.
 */
export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionMeta>();
  private events = new Map<string, SessionEvent[]>();
  private contextPacks = new Map<string, ContextPack>();

  /** participant/invocationId/filename → content */
  private artifactStore = new Map<string, string>();

  async createSession(meta: SessionMeta): Promise<void> {
    this.sessions.set(meta.id, structuredClone(meta));
    this.events.set(meta.id, []);
  }

  async loadSession(sessionId: string): Promise<SessionMeta> {
    const meta = this.sessions.get(sessionId);
    if (!meta) throw new Error(`Session not found: ${sessionId}`);
    return structuredClone(meta);
  }

  async updateMeta(sessionId: string, updates: Partial<SessionMeta>): Promise<void> {
    const meta = this.sessions.get(sessionId);
    if (!meta) throw new Error(`Session not found: ${sessionId}`);
    Object.assign(meta, updates);
  }

  async appendEvent(sessionId: string, event: SessionEvent): Promise<void> {
    const list = this.events.get(sessionId);
    if (!list) throw new Error(`Session not found: ${sessionId}`);
    list.push(structuredClone(event));
  }

  async loadEvents(sessionId: string): Promise<SessionEvent[]> {
    const list = this.events.get(sessionId);
    if (!list) throw new Error(`Session not found: ${sessionId}`);
    return list.map((e) => structuredClone(e));
  }

  async listSessions(): Promise<SessionMeta[]> {
    return [...this.sessions.values()].map((m) => structuredClone(m));
  }

  async saveContextPack(sessionId: string, pack: ContextPack): Promise<void> {
    this.contextPacks.set(`${sessionId}/${pack.id}`, structuredClone(pack));
  }

  async loadContextPack(sessionId: string, contextPackId: string): Promise<ContextPack> {
    const pack = this.contextPacks.get(`${sessionId}/${contextPackId}`);
    if (!pack) throw new Error(`Context pack not found: ${contextPackId}`);
    return structuredClone(pack);
  }

  async saveArtifact(
    sessionId: string,
    participant: string,
    invocationId: string,
    filename: string,
    content: string,
  ): Promise<void> {
    this.artifactStore.set(`${sessionId}/${participant}/${invocationId}/${filename}`, content);
  }

  // ── Test helpers ──

  /** Return artifact content, or undefined if not saved. */
  getArtifact(
    sessionId: string,
    participant: string,
    invocationId: string,
    filename: string,
  ): string | undefined {
    return this.artifactStore.get(`${sessionId}/${participant}/${invocationId}/${filename}`);
  }

  /** List artifact filenames saved for a participant across all invocations. */
  listArtifacts(sessionId: string, participant: string): string[] {
    const prefix = `${sessionId}/${participant}/`;
    return [...this.artifactStore.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length)); // "invocationId/filename"
  }
}
