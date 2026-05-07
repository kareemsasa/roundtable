import type { SessionEvent, TranscriptParticipant } from "@roundtable/core";

export type RenderOptions = {
  verbose: boolean;
  stream: boolean;
};

const PARTICIPANT_LABELS: Record<string, string> = {
  user: "You",
  claude: "Claude",
  codex: "Codex",
  steward: "Steward",
  roundtable: "Roundtable",
};

let lastParticipant: TranscriptParticipant | undefined;

export function resetRenderer(): void {
  lastParticipant = undefined;
}

function label(participant: TranscriptParticipant | undefined): string {
  if (!participant) return "Roundtable";
  return PARTICIPANT_LABELS[participant] ?? participant;
}

export function renderEvent(event: SessionEvent, options: RenderOptions): void {
  switch (event.type) {
    case "user_message": {
      const content = event.data.content as string;
      process.stdout.write(`\n${label(event.participant)}: ${content}\n`);
      lastParticipant = event.participant;
      break;
    }

    case "agent_chunk": {
      if (options.stream) {
        // Print header only if participant changed
        if (event.participant !== lastParticipant) {
          process.stdout.write(`\n${label(event.participant)}: `);
          lastParticipant = event.participant;
        }
        const content = event.data.content as string;
        process.stdout.write(content);
      }
      break;
    }

    case "agent_response_end": {
      // Skip rendering steward's raw response; steward_decision handles its output
      if (event.participant === "steward") {
        lastParticipant = event.participant;
        break;
      }
      if (!options.stream) {
        const content = event.data.content as string;
        process.stdout.write(`\n${label(event.participant)}: ${content}\n`);
      } else {
        // End the streaming line
        process.stdout.write("\n");
      }
      lastParticipant = event.participant;
      break;
    }

    case "steward_decision": {
      const summary = event.data.summary as string;
      process.stdout.write(`\n${label(event.participant)}: ${summary}\n`);
      lastParticipant = event.participant;
      break;
    }

    case "agent_error": {
      const error = event.data.error as string;
      process.stderr.write(`\n${label(event.participant)} [error]: ${error}\n`);
      lastParticipant = event.participant;
      break;
    }

    case "deliberation_started": {
      if (options.verbose) {
        const deliberationId = event.deliberationId ?? event.data.deliberationId ?? "unknown";
        process.stdout.write(
          `\n${label(event.participant)}: Deliberation started (${deliberationId})\n`,
        );
      }
      break;
    }

    case "deliberation_ended": {
      if (options.verbose) {
        const reason = event.data.reason as string;
        process.stdout.write(`\n${label(event.participant)}: Deliberation ended (${reason})\n`);
      }
      break;
    }

    case "agent_invocation_started": {
      if (options.verbose) {
        const pid = event.data.pid as number;
        process.stdout.write(`\n${label(event.participant)}: Invocation started (pid: ${pid})\n`);
      }
      break;
    }

    default:
      // Other event types are silently ignored
      break;
  }
}
