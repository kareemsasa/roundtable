import { z } from "zod";

export const StewardDecisionSchema = z.object({
  status: z.enum(["concluded", "continue", "needs_user"]),
  reason: z.string(),
  summary: z.string(),
  decisionPoint: z.string().optional(),
  recommendedActions: z.array(z.string()).optional(),
  nextSpeakerHint: z.enum(["claude", "codex"]).optional(),
});

export const TranscriptParticipantSchema = z.enum([
  "user",
  "claude",
  "codex",
  "steward",
  "wardroom",
  "roundtable", // legacy: pre-rename events
]);

export const EventTypeSchema = z.enum([
  "user_message",
  "deliberation_started",
  "agent_invocation_started",
  "agent_invocation_metadata",
  "agent_chunk",
  "agent_response_end",
  "agent_error",
  "agent_invocation_timeout",
  "output_truncated",
  "steward_decision",
  "steward_parse_error",
  "deliberation_ended",
  "deliberation_interrupted",
  "context_pack_built",
  "session_started",
  "session_archived",
  "engine_state_changed",
]);

export const SessionEventSchema = z.object({
  id: z.string(),
  type: EventTypeSchema,
  timestamp: z.string(),
  sessionId: z.string(),
  deliberationId: z.string().optional(),
  contextPackId: z.string().optional(),
  participant: TranscriptParticipantSchema.optional(),
  data: z.record(z.unknown()),
});

export const SessionMetaSchema = z.object({
  id: z.string(),
  status: z.enum(["awaiting_user", "deliberating", "archived", "error"]),
  title: z.string().optional(),
  targetPath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentContextPackId: z.string(),
  configSnapshot: z.record(z.unknown()),
  participants: z.array(
    z.object({
      id: TranscriptParticipantSchema,
      adapter: z.string(),
    }),
  ),
  latestStewardSummary: z.string().optional(),
});
