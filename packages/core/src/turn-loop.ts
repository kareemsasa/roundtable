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
 * Determine whether an agent invocation resulted in failure.
 * Returns true if the adapter emitted an error or timeout event.
 */
type InvokeResult = {
  failed: boolean;
  events: SessionEvent[];
};

/**
 * Invoke a single adapter and collect SessionEvents.
 * Catches thrown exceptions and maps them to agent_error events.
 */
async function invokeAdapter(
  adapter: AgentAdapter,
  input: AgentInput,
  participant: TranscriptParticipant,
  sessionId: string,
  deliberationId: string,
  contextPackId: string,
  signal?: AbortSignal,
): Promise<InvokeResult> {
  const events: SessionEvent[] = [];
  let failed = false;

  try {
    for await (const agentEvent of adapter.invoke(input, signal)) {
      const sessionType = mapAgentEventType(agentEvent.type);

      // For errors and timeouts, set participant to "roundtable"
      const isErrorLike = agentEvent.type === "error" || agentEvent.type === "timeout";
      const eventParticipant: TranscriptParticipant = isErrorLike ? "roundtable" : participant;

      // Extract data from the agent event (strip the 'type' field)
      const { type: _agentType, ...data } = agentEvent;
      void _agentType;

      const sessionEvent = makeSessionEvent(
        sessionType,
        sessionId,
        data as Record<string, unknown>,
        {
          deliberationId,
          contextPackId,
          participant: eventParticipant,
        },
      );

      events.push(sessionEvent);

      if (isErrorLike) {
        failed = true;
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorEvent = makeSessionEvent(
      "agent_error",
      sessionId,
      { error: errorMessage },
      {
        deliberationId,
        contextPackId,
        participant: "roundtable",
      },
    );
    events.push(errorEvent);
    failed = true;
  }

  return { failed, events };
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

    const claudeResult = await invokeAdapter(
      adapters.claude,
      claudeInput,
      "claude",
      sessionId,
      deliberationId,
      contextPackId,
      signal,
    );
    for (const event of claudeResult.events) {
      yield emit(event);
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

    const codexResult = await invokeAdapter(
      adapters.codex,
      codexInput,
      "codex",
      sessionId,
      deliberationId,
      contextPackId,
      signal,
    );
    for (const event of codexResult.events) {
      yield emit(event);
    }

    // --- Check for double failure ---
    if (claudeResult.failed && codexResult.failed) {
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

    const stewardResult = await invokeAdapter(
      adapters.steward,
      stewardInput,
      "steward",
      sessionId,
      deliberationId,
      contextPackId,
      signal,
    );

    // Emit steward adapter events
    for (const event of stewardResult.events) {
      yield emit(event);
    }

    if (stewardResult.failed) {
      // Steward itself failed (error/timeout) — treat as parse error scenario
      endReason = "steward_error";
      roundsCompleted = round;
      break;
    }

    // Find the response_end event from the steward to parse the decision
    const stewardResponseEnd = stewardResult.events.find((e) => e.type === "agent_response_end");
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
