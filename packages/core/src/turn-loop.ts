import { nanoid } from "nanoid";
import { StewardDecisionSchema } from "./schemas.js";
import { buildTranscript } from "./transcript.js";
import type {
  AgentAdapter,
  AgentEvent,
  AgentInput,
  ContextPack,
  DeliberationLimits,
  EventType,
  SessionEvent,
  StewardDecision,
  TranscriptMessage,
  TranscriptParticipant,
} from "./types.js";

// === Public Types ===

export type DeliberationInput = {
  sessionId: string;
  userMessage: string;
  contextPack: ContextPack;
  priorTranscript: TranscriptMessage[];
  adapters: {
    claude: AgentAdapter;
    codex: AgentAdapter;
    steward: AgentAdapter;
  };
  limits: DeliberationLimits;
  systemPrompts: {
    claude: string;
    codex: string;
    steward: string;
  };
  signal?: AbortSignal;
};

// === Helpers ===

function makeEventId(): string {
  return `evt_${nanoid(12)}`;
}

function makeDeliberationId(): string {
  return `del_${nanoid(12)}`;
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

/** Map an AgentEvent type to the corresponding SessionEvent type */
function mapAgentEventType(agentType: AgentEvent["type"]): EventType {
  switch (agentType) {
    case "invocation_started":
      return "agent_invocation_started";
    case "invocation_metadata":
      return "agent_invocation_metadata";
    case "chunk":
      return "agent_chunk";
    case "response_end":
      return "agent_response_end";
    case "error":
      return "agent_error";
    case "timeout":
      return "agent_invocation_timeout";
    case "output_truncated":
      return "output_truncated";
  }
}

/**
 * Invoke a single adapter, yielding SessionEvents as they arrive.
 * Catches thrown exceptions and yields them as agent_error events.
 *
 * Callers should track failure by inspecting yielded event types
 * (agent_error, agent_invocation_timeout).
 */
async function* invokeAdapter(
  adapter: AgentAdapter,
  input: AgentInput,
  participant: TranscriptParticipant,
  sessionId: string,
  deliberationId: string,
  contextPackId: string,
  signal?: AbortSignal,
): AsyncGenerator<SessionEvent> {
  try {
    for await (const agentEvent of adapter.invoke(input, signal)) {
      const sessionType = mapAgentEventType(agentEvent.type);

      // For errors and timeouts, set participant to "roundtable"
      const isErrorLike = agentEvent.type === "error" || agentEvent.type === "timeout";
      const eventParticipant: TranscriptParticipant = isErrorLike ? "roundtable" : participant;

      // Extract data from the agent event (strip the 'type' field)
      const { type: _agentType, ...data } = agentEvent;
      void _agentType;

      yield makeSessionEvent(
        sessionType,
        sessionId,
        {
          ...(data as Record<string, unknown>),
          invocationId: input.invocationId,
          ...(isErrorLike ? { sourceParticipant: participant } : {}),
        },
        {
          deliberationId,
          contextPackId,
          participant: eventParticipant,
        },
      );
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    yield makeSessionEvent(
      "agent_error",
      sessionId,
      {
        error: errorMessage,
        invocationId: input.invocationId,
        sourceParticipant: participant,
      },
      {
        deliberationId,
        contextPackId,
        participant: "roundtable",
      },
    );
  }
}

/** Check if a session event indicates invocation failure */
function isFailureEvent(event: SessionEvent): boolean {
  return event.type === "agent_error" || event.type === "agent_invocation_timeout";
}

// === Main Generator ===

export async function* runDeliberation(input: DeliberationInput): AsyncGenerator<SessionEvent> {
  const {
    sessionId,
    userMessage,
    contextPack,
    priorTranscript,
    adapters,
    limits,
    systemPrompts,
    signal,
  } = input;

  const deliberationId = makeDeliberationId();
  const contextPackId = contextPack.id;

  // Accumulate events emitted during this deliberation for transcript building
  const emittedEvents: SessionEvent[] = [];

  function emit(event: SessionEvent): SessionEvent {
    emittedEvents.push(event);
    return event;
  }

  // 1. Yield user_message
  yield emit(
    makeSessionEvent(
      "user_message",
      sessionId,
      { content: userMessage },
      {
        participant: "user",
      },
    ),
  );

  // 2. Yield deliberation_started
  const userMessageEventId = emittedEvents[0].id;
  yield emit(
    makeSessionEvent(
      "deliberation_started",
      sessionId,
      {
        userMessageEventId,
        contextPackId,
      },
      {
        deliberationId,
        contextPackId,
      },
    ),
  );

  // Helper to check abort
  function isAborted(): boolean {
    return signal?.aborted === true;
  }

  let endReason: string = "concluded";
  let roundsCompleted = 0;

  // === Round Loop ===
  for (let round = 1; round <= limits.maxRounds; round++) {
    if (isAborted()) {
      endReason = "user_stop";
      yield emit(
        makeSessionEvent(
          "deliberation_interrupted",
          sessionId,
          { reason: "user_stop" },
          {
            deliberationId,
            contextPackId,
            participant: "roundtable",
          },
        ),
      );
      return; // no deliberation_ended after interrupt — the interrupt IS the end signal
    }

    // Build the current transcript from prior + emitted events
    const currentTranscript = [
      ...priorTranscript,
      ...buildTranscript(emittedEvents, limits.maxTranscriptBytes),
    ];

    // --- Invoke Claude ---
    const claudeInput: AgentInput = {
      invocationId: `inv_${nanoid(12)}`,
      contextPack,
      transcript: currentTranscript,
      systemPrompt: systemPrompts.claude,
      deliberationId,
    };

    let claudeFailed = false;
    for await (const event of invokeAdapter(
      adapters.claude,
      claudeInput,
      "claude",
      sessionId,
      deliberationId,
      contextPackId,
      signal,
    )) {
      yield emit(event);
      if (isFailureEvent(event)) claudeFailed = true;
    }

    // --- Invoke Codex ---
    // Rebuild transcript with claude's response included
    const transcriptAfterClaude = [
      ...priorTranscript,
      ...buildTranscript(emittedEvents, limits.maxTranscriptBytes),
    ];

    const codexInput: AgentInput = {
      invocationId: `inv_${nanoid(12)}`,
      contextPack,
      transcript: transcriptAfterClaude,
      systemPrompt: systemPrompts.codex,
      deliberationId,
    };

    let codexFailed = false;
    for await (const event of invokeAdapter(
      adapters.codex,
      codexInput,
      "codex",
      sessionId,
      deliberationId,
      contextPackId,
      signal,
    )) {
      yield emit(event);
      if (isFailureEvent(event)) codexFailed = true;
    }

    // --- Check for double failure ---
    if (claudeFailed && codexFailed) {
      endReason = "double_failure";
      roundsCompleted = round;
      break;
    }

    // --- Invoke Steward ---
    const transcriptForSteward = [
      ...priorTranscript,
      ...buildTranscript(emittedEvents, limits.maxTranscriptBytes),
    ];

    const stewardInput: AgentInput = {
      invocationId: `inv_${nanoid(12)}`,
      contextPack,
      transcript: transcriptForSteward,
      systemPrompt: systemPrompts.steward,
      deliberationId,
    };

    let stewardFailed = false;
    for await (const event of invokeAdapter(
      adapters.steward,
      stewardInput,
      "steward",
      sessionId,
      deliberationId,
      contextPackId,
      signal,
    )) {
      yield emit(event);
      if (isFailureEvent(event)) stewardFailed = true;
    }

    if (stewardFailed) {
      // Steward itself failed (error/timeout) — treat as parse error scenario
      endReason = "steward_error";
      roundsCompleted = round;
      break;
    }

    // Find the response_end event from the steward to parse the decision
    const stewardResponseEnd = emittedEvents.find(
      (e) =>
        e.type === "agent_response_end" && e.data.invocationId === stewardInput.invocationId,
    );
    if (!stewardResponseEnd) {
      // No response_end — shouldn't happen if not failed, but handle gracefully
      endReason = "steward_error";
      roundsCompleted = round;
      break;
    }

    const rawContent = stewardResponseEnd.data.content as string;

    // Try to parse and validate the steward's decision
    let decision: StewardDecision;
    try {
      const parsed = JSON.parse(rawContent);
      decision = StewardDecisionSchema.parse(parsed);
    } catch {
      // Parse or validation failure
      yield emit(
        makeSessionEvent(
          "steward_parse_error",
          sessionId,
          {
            rawContent,
            error: "Failed to parse steward response as valid StewardDecision JSON",
          },
          {
            deliberationId,
            contextPackId,
            participant: "roundtable",
          },
        ),
      );
      endReason = "steward_parse_error";
      roundsCompleted = round;
      break;
    }

    // Emit steward_decision
    yield emit(
      makeSessionEvent(
        "steward_decision",
        sessionId,
        decision as unknown as Record<string, unknown>,
        {
          deliberationId,
          contextPackId,
          participant: "steward",
        },
      ),
    );

    roundsCompleted = round;

    // Evaluate steward decision
    if (decision.status === "concluded") {
      endReason = "concluded";
      break;
    } else if (decision.status === "needs_user") {
      endReason = "needs_user";
      break;
    } else if (decision.status === "continue") {
      if (round >= limits.maxRounds) {
        endReason = "max_rounds_reached";
        break;
      }
      // Otherwise, continue to next round
    }
  }

  // If we went through the loop without breaking (shouldn't happen given the logic, but safety)
  if (roundsCompleted === 0) {
    roundsCompleted = 1;
  }

  // Yield deliberation_ended
  yield emit(
    makeSessionEvent(
      "deliberation_ended",
      sessionId,
      {
        reason: endReason,
        rounds: roundsCompleted,
      },
      {
        deliberationId,
        contextPackId,
      },
    ),
  );
}
