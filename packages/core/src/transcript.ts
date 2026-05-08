import type { SessionEvent, TranscriptMessage, StewardDecision } from "./types.js";

const DISPLAY_EVENT_TYPES = new Set([
  "user_message",
  "agent_response_end",
  "steward_decision",
  "agent_error",
]);

function extractDisplayContent(event: SessionEvent): string {
  const data = event.data;
  switch (event.type) {
    case "user_message":
      return data.content as string;
    case "agent_response_end":
      return data.content as string;
    case "steward_decision":
      return (data as unknown as StewardDecision).summary;
    case "agent_error":
      return data.error as string;
    default:
      return "";
  }
}

export function buildTranscript(events: SessionEvent[], maxBytes?: number): TranscriptMessage[] {
  const all = events
    .filter((e) => DISPLAY_EVENT_TYPES.has(e.type) && e.participant)
    // Skip steward's raw agent_response_end; steward_decision carries the rendered output
    .filter((e) => !(e.type === "agent_response_end" && e.participant === "steward"))
    .map((e) => ({
      participant: e.participant!,
      content: extractDisplayContent(e),
      timestamp: e.timestamp,
    }));

  if (!maxBytes) return all;

  // Budget enforcement: walk from newest to oldest, keep what fits
  let totalBytes = 0;
  const result: TranscriptMessage[] = [];

  for (let i = all.length - 1; i >= 0; i--) {
    const msgBytes = Buffer.byteLength(all[i].content, "utf-8");
    if (totalBytes + msgBytes > maxBytes && result.length > 0) {
      result.unshift({
        participant: "roundtable",
        content: `[${i + 1} earlier message(s) omitted due to transcript budget]`,
        timestamp: all[0].timestamp,
      });
      break;
    }
    totalBytes += msgBytes;
    result.unshift(all[i]);
  }

  return result;
}
