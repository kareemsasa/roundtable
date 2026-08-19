// === Participants ===

export type TranscriptParticipant =
  | "user"
  | "claude"
  | "codex"
  | "steward"
  | "wardroom"
  | "roundtable"; // legacy: pre-rename events

// === Session State ===

export type SessionRuntimeState = "awaiting_user" | "deliberating" | "archived" | "error";

// === Deliberation State ===

export type DeliberationState =
  | "started"
  | "invoking_claude"
  | "invoking_codex"
  | "invoking_steward"
  | "concluded"
  | "error";

export type Deliberation = {
  id: string;
  contextPackId: string;
  round: number;
  maxRounds: number;
  state: DeliberationState;
};

// === Steward Decision ===

export type StewardDecision = {
  status: "concluded" | "continue" | "needs_user";
  reason: string;
  summary: string;
  decisionPoint?: string;
  recommendedActions?: string[];
  nextSpeakerHint?: "claude" | "codex";
};

// === Events ===

export type EventType =
  | "user_message"
  | "deliberation_started"
  | "agent_invocation_started"
  | "agent_invocation_metadata"
  | "agent_chunk"
  | "agent_response_end"
  | "agent_error"
  | "agent_invocation_timeout"
  | "output_truncated"
  | "steward_decision"
  | "steward_parse_error"
  | "deliberation_ended"
  | "deliberation_interrupted"
  | "context_pack_built"
  | "session_started"
  | "session_archived"
  | "engine_state_changed";

export type SessionEvent = {
  id: string;
  type: EventType;
  timestamp: string;
  sessionId: string;
  deliberationId?: string;
  contextPackId?: string;
  participant?: TranscriptParticipant;
  data: Record<string, unknown>;
};

// === Transcript ===

export type TranscriptMessage = {
  participant: TranscriptParticipant;
  content: string;
  timestamp: string;
};

// === Context Pack ===

export type FileCategory =
  | "wardroom_config"
  | "agent_config"
  | "project_meta"
  | "documentation"
  | "source"
  | "config"
  | "other";

export type ContextFile = {
  path: string;
  category: FileCategory;
  content: string;
  bytes: number;
  truncated: boolean;
};

export type DirectoryTree = {
  name: string;
  type: "file" | "directory";
  children?: DirectoryTree[];
};

export type GitSummary = {
  branch: string;
  status: string;
  recentCommits: { hash: string; message: string; date: string }[];
  diffStat?: string;
};

export type OmittedReport = {
  categories: { category: string; count: number; reason: string }[];
  files: { path: string; reason: string }[];
};

export type ContextPack = {
  id: string;
  version: number;
  targetPath: string;
  displayPath: string;
  createdAt: string;
  config: ContextConfig;
  tree: DirectoryTree;
  files: ContextFile[];
  gitSummary?: GitSummary;
  omitted: OmittedReport;
  stats: {
    totalFiles: number;
    includedFiles: number;
    totalBytes: number;
    budgetBytes: number;
  };
};

// === Config ===

export type ContextConfig = {
  budgetBytes: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTreeDepth: number;
  includes?: string[];
  excludes?: string[];
};

export type AdapterMode = "read_only" | "mock";

export type AdapterLimits = {
  invocationTimeoutMs: number;
  maxOutputBytes: number;
  gracefulShutdownMs: number;
};

export type AdapterConfig = {
  command: string;
  mode: AdapterMode;
  limits: AdapterLimits;
  /** Optional model override passed to the underlying CLI (e.g. Codex `-m`). */
  model?: string;
};

export type DeliberationLimits = {
  maxRounds: number;
  participantTimeoutMs: number;
  deliberationTimeoutMs: number;
  maxTranscriptBytes?: number;
};

export type WardroomConfig = {
  dataDir: string;
  context: ContextConfig;
  deliberation: DeliberationLimits;
  adapters: {
    claude: AdapterConfig;
    codex: AdapterConfig;
    steward: AdapterConfig;
  };
};

/** Alias for clarity — a fully resolved config with no optionals */
export type ResolvedConfig = WardroomConfig;

// === Session Meta ===

export type ParticipantConfig = {
  id: TranscriptParticipant;
  adapter: string;
};

export type SessionMeta = {
  id: string;
  status: SessionRuntimeState;
  title?: string;
  targetPath: string;
  createdAt: string;
  updatedAt: string;
  currentContextPackId: string;
  configSnapshot: ResolvedConfig;
  participants: ParticipantConfig[];
  latestStewardSummary?: string;
};

// === Session (runtime object) ===

export type Session = {
  meta: SessionMeta;
  events: SessionEvent[];
  currentDeliberation?: Deliberation;
};

// === Agent Adapter Interface ===

export type AgentEvent =
  | { type: "invocation_started"; command: string; pid: number; timestamp: string }
  | { type: "invocation_metadata"; cwd: string; command: string; args: string[]; envKeys: string[] }
  | { type: "chunk"; content: string; stream: "stdout" | "stderr" }
  | { type: "response_end"; content: string; durationMs: number; exitCode: number; stderr?: string }
  | { type: "error"; error: string; stderr?: string; stdout?: string; exitCode?: number }
  | { type: "timeout"; durationMs: number; killed: boolean }
  | {
      type: "output_truncated";
      stream: "stdout" | "stderr";
      originalBytes: number;
      keptBytes: number;
    };

export type AgentInput = {
  invocationId: string;
  contextPack: ContextPack;
  transcript: TranscriptMessage[];
  systemPrompt: string;
  deliberationId: string;
};

export interface AgentAdapter {
  id: string;
  invoke(input: AgentInput, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

// === Session Store Interface ===

export interface SessionStore {
  createSession(meta: SessionMeta): Promise<void>;
  loadSession(sessionId: string): Promise<SessionMeta>;
  updateMeta(sessionId: string, updates: Partial<SessionMeta>): Promise<void>;
  appendEvent(sessionId: string, event: SessionEvent): Promise<void>;
  loadEvents(sessionId: string): Promise<SessionEvent[]>;
  listSessions(): Promise<SessionMeta[]>;
  saveContextPack(sessionId: string, pack: ContextPack): Promise<void>;
  loadContextPack(sessionId: string, contextPackId: string): Promise<ContextPack>;
  saveArtifact(
    sessionId: string,
    participant: string,
    invocationId: string,
    filename: string,
    content: string,
  ): Promise<void>;
}
