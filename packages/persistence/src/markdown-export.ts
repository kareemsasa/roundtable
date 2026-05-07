import type { SessionEvent, StewardDecision } from "@roundtable/core";

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
  roundtable: "Roundtable",
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
  const lines: string[] = [
    `# Roundtable Transcript`,
    "",
    `Session: \`${sessionId}\``,
    "",
    "---",
    "",
  ];
  for (const event of events) {
    if (!DISPLAY_EVENTS.has(event.type) || !event.participant) continue;
    const label = PARTICIPANT_LABELS[event.participant] ?? event.participant;
    lines.push(`**${label}**`, "", extractContent(event), "");
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
