import { nanoid } from "nanoid";
import { runDeliberation } from "./turn-loop.js";
import { buildTranscript } from "./transcript.js";
import type {
  AgentAdapter,
  ContextPack,
  WardroomConfig,
  Session,
  SessionEvent,
  SessionMeta,
  SessionStore,
  EventType,
  TranscriptParticipant,
} from "./types.js";

// === Default System Prompts ===

const DEFAULT_PROMPTS = {
  claude: "You are Claude, participating in a Wardroom deliberation. Respond thoughtfully.",
  codex: "You are Codex, participating in a Wardroom deliberation. Respond thoughtfully.",
  steward: `You are the Steward, a moderator in a Wardroom deliberation.
Evaluate the transcript and return a JSON object with this shape:
{ "status": "concluded" | "continue" | "needs_user", "reason": "...", "summary": "..." }
Respond ONLY with the JSON object, no other text.`,
};

// === Title Derivation ===

const MAX_TITLE_LENGTH = 80;

/**
 * Derive a session title from the first user message.
 * Trims, collapses whitespace, and truncates at a word boundary.
 * Returns undefined for empty/whitespace-only input.
 */
export function deriveSessionTitle(message: string): string | undefined {
  const cleaned = message.trim().replace(/\s+/g, " ");
  if (cleaned.length === 0) return undefined;
  if (cleaned.length <= MAX_TITLE_LENGTH) return cleaned;

  const truncated = cleaned.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  const breakPoint = lastSpace > 0 ? lastSpace : MAX_TITLE_LENGTH;
  return cleaned.slice(0, breakPoint) + "...";
}

// === Options ===

export type EngineOptions = {
  store: SessionStore;
  adapters: {
    claude: AgentAdapter;
    codex: AgentAdapter;
    steward: AgentAdapter;
  };
  config: WardroomConfig;
  systemPrompts?: {
    claude: string;
    codex: string;
    steward: string;
  };
};

// === Helpers ===

function makeEventId(): string {
  return `evt_${nanoid(12)}`;
}

function makeSessionEvent(
  type: EventType,
  sessionId: string,
  data: Record<string, unknown>,
  opts: {
    deliberationId?: string;
    contextPackId?: string;
    participant?: TranscriptParticipant;
  } = {},
): SessionEvent {
  return {
    id: makeEventId(),
    type,
    timestamp: new Date().toISOString(),
    sessionId,
    deliberationId: opts.deliberationId,
    contextPackId: opts.contextPackId,
    participant: opts.participant,
    data,
  };
}

// === Engine ===

export class WardroomEngine {
  private store: SessionStore;
  private adapters: { claude: AgentAdapter; codex: AgentAdapter; steward: AgentAdapter };
  private config: WardroomConfig;
  private systemPrompts: { claude: string; codex: string; steward: string };

  constructor(options: EngineOptions) {
    this.store = options.store;
    this.adapters = options.adapters;
    this.config = options.config;
    this.systemPrompts = options.systemPrompts ?? { ...DEFAULT_PROMPTS };
  }

  async startSession(targetPath: string, contextPack: ContextPack): Promise<Session> {
    const sessionId = `rt_${nanoid(16)}`;
    const now = new Date().toISOString();

    const meta: SessionMeta = {
      id: sessionId,
      status: "awaiting_user",
      targetPath,
      createdAt: now,
      updatedAt: now,
      currentContextPackId: contextPack.id,
      configSnapshot: this.config,
      participants: [
        { id: "claude", adapter: this.config.adapters.claude.command },
        { id: "codex", adapter: this.config.adapters.codex.command },
        { id: "steward", adapter: this.config.adapters.steward.command },
      ],
    };

    await this.store.createSession(meta);
    await this.store.saveContextPack(sessionId, contextPack);

    const events: SessionEvent[] = [];

    // Emit session_started
    const sessionStartedEvent = makeSessionEvent(
      "session_started",
      sessionId,
      {
        targetPath,
        contextPackId: contextPack.id,
      },
      { participant: "wardroom" },
    );
    await this.store.appendEvent(sessionId, sessionStartedEvent);
    events.push(sessionStartedEvent);

    // Emit context_pack_built
    const contextPackBuiltEvent = makeSessionEvent(
      "context_pack_built",
      sessionId,
      {
        contextPackId: contextPack.id,
        version: contextPack.version,
        fileCount: contextPack.stats.includedFiles,
        totalBytes: contextPack.stats.totalBytes,
      },
      { participant: "wardroom" },
    );
    await this.store.appendEvent(sessionId, contextPackBuiltEvent);
    events.push(contextPackBuiltEvent);

    return { meta, events };
  }

  async resumeSession(sessionId: string): Promise<Session> {
    const meta = await this.store.loadSession(sessionId);
    const events = await this.store.loadEvents(sessionId);
    return { meta, events };
  }

  async *submitMessage(
    session: Session,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<SessionEvent> {
    const { meta } = session;

    // Update status to deliberating; set title from first message if not yet set
    meta.status = "deliberating";
    const metaUpdates: Partial<SessionMeta> = {
      status: "deliberating",
      updatedAt: new Date().toISOString(),
    };
    if (!meta.title) {
      const title = deriveSessionTitle(message);
      if (title) {
        meta.title = title;
        metaUpdates.title = title;
      }
    }
    await this.store.updateMeta(meta.id, metaUpdates);

    let normalCompletion = false;

    try {
      // Load context pack
      const contextPack = await this.store.loadContextPack(meta.id, meta.currentContextPackId);

      // Build prior transcript from existing session events
      const priorTranscript = buildTranscript(
        session.events,
        this.config.deliberation.maxTranscriptBytes,
      );

      // Run deliberation
      const deliberation = runDeliberation({
        sessionId: meta.id,
        userMessage: message,
        contextPack,
        priorTranscript,
        adapters: this.adapters,
        limits: this.config.deliberation,
        systemPrompts: this.systemPrompts,
        signal,
      });

      // Track pending invocations for artifact persistence
      type PendingInvocation = {
        participant: string;
        artifactMeta: Record<string, unknown>;
      };
      const pending = new Map<string, PendingInvocation>();

      for await (const event of deliberation) {
        // Persist every event
        await this.store.appendEvent(meta.id, event);
        session.events.push(event);

        // --- Artifact accumulation & persistence (best-effort) ---
        const invocationId = event.data.invocationId as string | undefined;

        if (invocationId && event.type === "agent_invocation_started") {
          pending.set(invocationId, {
            participant: event.participant ?? "unknown",
            artifactMeta: {
              invocationId,
              command: event.data.command,
              pid: event.data.pid,
              startedAt: event.data.timestamp,
            },
          });
        }

        if (invocationId && event.type === "agent_invocation_metadata") {
          const p = pending.get(invocationId);
          if (p) {
            Object.assign(p.artifactMeta, {
              cwd: event.data.cwd,
              args: event.data.args,
              envKeys: event.data.envKeys,
            });
          }
        }

        if (invocationId && event.type === "agent_response_end") {
          const p = pending.get(invocationId);
          if (p) {
            Object.assign(p.artifactMeta, {
              exitCode: event.data.exitCode,
              durationMs: event.data.durationMs,
            });
            try {
              await this.store.saveArtifact(
                meta.id,
                p.participant,
                invocationId,
                "meta.json",
                JSON.stringify(p.artifactMeta, null, 2),
              );
              await this.store.saveArtifact(
                meta.id,
                p.participant,
                invocationId,
                "stdout.log",
                (event.data.content as string) ?? "",
              );
              if (event.data.stderr) {
                await this.store.saveArtifact(
                  meta.id,
                  p.participant,
                  invocationId,
                  "stderr.log",
                  event.data.stderr as string,
                );
              }
            } catch {
              // Artifact persistence is best-effort; deliberation continues
            }
            pending.delete(invocationId);
          }
        }

        if (invocationId && event.type === "agent_error") {
          let p = pending.get(invocationId);
          if (!p) {
            // Adapter threw before yielding invocation_started
            const src = (event.data.sourceParticipant as string) ?? "unknown";
            p = { participant: src, artifactMeta: { invocationId } };
          }
          Object.assign(p.artifactMeta, {
            exitCode: event.data.exitCode,
            error: event.data.error,
          });
          try {
            await this.store.saveArtifact(
              meta.id,
              p.participant,
              invocationId,
              "meta.json",
              JSON.stringify(p.artifactMeta, null, 2),
            );
            if (event.data.stdout) {
              await this.store.saveArtifact(
                meta.id,
                p.participant,
                invocationId,
                "stdout.log",
                event.data.stdout as string,
              );
            }
            if (event.data.stderr) {
              await this.store.saveArtifact(
                meta.id,
                p.participant,
                invocationId,
                "stderr.log",
                event.data.stderr as string,
              );
            }
          } catch {
            // Artifact persistence is best-effort; deliberation continues
          }
          pending.delete(invocationId);
        }

        if (invocationId && event.type === "agent_invocation_timeout") {
          const p = pending.get(invocationId);
          if (p) {
            Object.assign(p.artifactMeta, {
              timeout: true,
              durationMs: event.data.durationMs,
            });
            try {
              await this.store.saveArtifact(
                meta.id,
                p.participant,
                invocationId,
                "meta.json",
                JSON.stringify(p.artifactMeta, null, 2),
              );
            } catch {
              // Artifact persistence is best-effort; deliberation continues
            }
            pending.delete(invocationId);
          }
        }

        // If steward_decision, update meta with latest summary (best-effort)
        if (event.type === "steward_decision") {
          const summary = event.data.summary as string | undefined;
          if (summary) {
            meta.latestStewardSummary = summary;
            try {
              await this.store.updateMeta(meta.id, {
                latestStewardSummary: summary,
                updatedAt: new Date().toISOString(),
              });
            } catch {
              // Steward summary persistence is best-effort; deliberation continues
            }
          }
        }

        yield event;
      }

      // After deliberation, set status back to awaiting_user
      await this.store.updateMeta(meta.id, {
        status: "awaiting_user",
        updatedAt: new Date().toISOString(),
      });
      meta.status = "awaiting_user";
      normalCompletion = true;
    } catch (err) {
      // Persist error event (best-effort) before re-throwing
      const errorMessage = err instanceof Error ? err.message : String(err);
      try {
        const errorEvent = makeSessionEvent(
          "deliberation_interrupted",
          meta.id,
          {
            reason: "engine_error",
            error: errorMessage,
          },
          { participant: "wardroom" },
        );
        await this.store.appendEvent(meta.id, errorEvent);
        session.events.push(errorEvent);
      } catch {
        // Event persistence also failed; continue to cleanup
      }
      throw err;
    } finally {
      // Guarantee session is never left stuck in "deliberating"
      if (!normalCompletion && meta.status === "deliberating") {
        try {
          await this.store.updateMeta(meta.id, {
            status: "awaiting_user",
            updatedAt: new Date().toISOString(),
          });
          meta.status = "awaiting_user";
        } catch {
          // Status update failed; mark as error
          try {
            await this.store.updateMeta(meta.id, {
              status: "error",
              updatedAt: new Date().toISOString(),
            });
            meta.status = "error";
          } catch {
            // Persistence is completely down; in-memory state is best-effort
            meta.status = "error";
          }
        }
      }
    }
  }

  async refreshContext(session: Session, contextPack: ContextPack): Promise<ContextPack> {
    const { meta } = session;

    // Save new context pack
    await this.store.saveContextPack(meta.id, contextPack);

    // Emit context_pack_built event
    const event = makeSessionEvent(
      "context_pack_built",
      meta.id,
      {
        contextPackId: contextPack.id,
        version: contextPack.version,
        fileCount: contextPack.stats.includedFiles,
        totalBytes: contextPack.stats.totalBytes,
      },
      { participant: "wardroom" },
    );
    await this.store.appendEvent(meta.id, event);
    session.events.push(event);

    // Update meta
    meta.currentContextPackId = contextPack.id;
    await this.store.updateMeta(meta.id, {
      currentContextPackId: contextPack.id,
      updatedAt: new Date().toISOString(),
    });

    return contextPack;
  }

  async archiveSession(session: Session): Promise<void> {
    const { meta } = session;

    // Emit session_archived event
    const event = makeSessionEvent(
      "session_archived",
      meta.id,
      {},
      {
        participant: "wardroom",
      },
    );
    await this.store.appendEvent(meta.id, event);
    session.events.push(event);

    // Update status
    meta.status = "archived";
    await this.store.updateMeta(meta.id, {
      status: "archived",
      updatedAt: new Date().toISOString(),
    });
  }
}
