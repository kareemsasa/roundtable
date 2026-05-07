import type { AgentAdapter, AgentInput, AgentEvent, AdapterConfig } from "@roundtable/core";
import { renderContextPackMarkdown } from "@roundtable/context";
import { tmpDir } from "@roundtable/persistence";
import { mkdir, rm } from "node:fs/promises";
import { spawnCliAgent } from "./cli-agent.js";

export class StewardAdapter implements AgentAdapter {
  id = "steward";
  private config: AdapterConfig;
  private dataDir: string;

  constructor(config: AdapterConfig, dataDir: string) {
    this.config = config;
    this.dataDir = dataDir;
  }

  async *invoke(input: AgentInput, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const cwd = tmpDir(this.dataDir, input.invocationId);
    await mkdir(cwd, { recursive: true });

    try {
      const prompt = buildStewardPrompt(input);

      for await (const event of spawnCliAgent({
        command: this.config.command,
        args: [
          "--print",
          "--system-prompt",
          input.systemPrompt,
          "--output-format",
          "text",
          "--no-session-persistence",
          "--bare",
          "--permission-mode",
          "plan",
          "--tools",
          "",
        ],
        cwd,
        timeoutMs: this.config.limits.invocationTimeoutMs,
        maxOutputBytes: this.config.limits.maxOutputBytes,
        gracefulShutdownMs: this.config.limits.gracefulShutdownMs,
        signal,
        stdin: prompt,
      })) {
        if (event.type === "response_end") {
          // Clean up the response content: strip markdown fences, trim
          yield {
            ...event,
            content: cleanJsonResponse(event.content),
          };
        } else {
          yield event;
        }
      }
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function buildStewardPrompt(input: AgentInput): string {
  const contextMd = renderContextPackMarkdown(input.contextPack);
  const transcriptText = input.transcript
    .map((t) => `${t.participant}: ${t.content}`)
    .join("\n\n");

  const parts: string[] = [];
  parts.push("# Context Pack");
  parts.push(contextMd);
  if (input.transcript.length > 0) {
    parts.push("# Transcript");
    parts.push(transcriptText);
  }
  parts.push("# Instructions");
  parts.push("Respond ONLY with a JSON object matching this schema:");
  parts.push(
    '{ "status": "concluded" | "continue" | "needs_user", "reason": "...", "summary": "..." }',
  );
  parts.push("Optional fields: decisionPoint, recommendedActions, nextSpeakerHint");
  parts.push("Do not include any other text, markdown formatting, or code fences.");
  return parts.join("\n\n");
}

/**
 * Clean up LLM response to extract JSON:
 * - Strip markdown code fences (```json ... ```)
 * - Trim whitespace
 * - Extract first JSON object if surrounded by text
 */
function cleanJsonResponse(raw: string): string {
  let cleaned = raw.trim();

  // Strip markdown code fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Try to extract a JSON object if there's surrounding text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  return cleaned;
}
