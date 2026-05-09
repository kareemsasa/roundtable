import type { SessionEvent, StewardDecision } from "@wardroom/core";

const DISPLAY_EVENTS = new Set([
  "user_message",
  "agent_response_end",
  "steward_decision",
  "agent_error",
]);

const PARTICIPANT_LABELS: Record<string, string> = {
  user: "You",
  claude: "Claude",
  codex: "Codex",
  steward: "Steward",
  wardroom: "Wardroom",
  roundtable: "Wardroom", // legacy: pre-rename events
};

function extractContent(event: SessionEvent): string {
  const data = event.data;
  if (event.type === "user_message") return data.content as string;
  if (event.type === "agent_response_end") return data.content as string;
  if (event.type === "steward_decision") return (data as unknown as StewardDecision).summary;
  if (event.type === "agent_error") return data.error as string;
  return "";
}

export function generateTranscriptMarkdown(events: SessionEvent[], sessionId: string): string {
  const lines: string[] = [`# Wardroom Transcript`, "", `Session: \`${sessionId}\``, "", "---", ""];
  for (const event of events) {
    if (!DISPLAY_EVENTS.has(event.type) || !event.participant) continue;
    // Skip steward's raw agent_response_end; steward_decision carries the rendered output
    if (event.type === "agent_response_end" && event.participant === "steward") continue;
    const label = PARTICIPANT_LABELS[event.participant] ?? event.participant;
    const content = extractContent(event);
    lines.push(`**${label}**`, "", content, "");

    // Render optional steward decision details inline
    if (event.type === "steward_decision") {
      const data = event.data as unknown as StewardDecision;
      if (data.decisionPoint) {
        lines.push(`**Decision Point:** ${data.decisionPoint}`, "");
      }
      if (data.recommendedActions?.length) {
        lines.push("**Recommended Actions:**", "");
        for (const action of data.recommendedActions) {
          lines.push(`- ${action}`);
        }
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}

export function generateStewardSummaryMarkdown(decision: StewardDecision): string {
  const lines: string[] = [
    "# Steward Summary",
    "",
    `**Status:** ${decision.status}`,
    "",
    `**Reason:** ${decision.reason}`,
    "",
    "## Summary",
    "",
    decision.summary,
    "",
  ];
  if (decision.decisionPoint) {
    lines.push("## Decision Point", "", decision.decisionPoint, "");
  }
  if (decision.recommendedActions?.length) {
    lines.push("## Recommended Actions", "");
    for (const action of decision.recommendedActions) {
      lines.push(`- ${action}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
