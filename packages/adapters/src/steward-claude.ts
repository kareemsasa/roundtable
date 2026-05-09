import type { AgentAdapter, AgentInput, AgentEvent, AdapterConfig } from "@wardroom/core";
import { renderContextPackMarkdown } from "@wardroom/context";
import { tmpDir } from "@wardroom/persistence";
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

      // Buffer stdout chunks so auth/error text is never emitted as speech.
      // If response_end detects an error, suppress the chunks and yield an error event instead.
      const bufferedChunks: AgentEvent[] = [];

      for await (const event of spawnCliAgent({
        command: this.config.command,
        args: [
          "--print",
          "--system-prompt",
          input.systemPrompt,
          "--output-format",
          "text",
          "--no-session-persistence",
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
        if (event.type === "chunk" && event.stream === "stdout") {
          bufferedChunks.push(event);
        } else if (event.type === "response_end") {
          const authError = detectClaudeError(event.content);
          if (authError) {
            yield { type: "error", error: authError, stderr: event.content, exitCode: 0 };
          } else {
            for (const chunk of bufferedChunks) yield chunk;
            // Clean up the response content: strip markdown fences, trim
            yield {
              ...event,
              content: cleanJsonResponse(event.content),
            };
          }
        } else {
          yield event;
        }
      }
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  }
}

const CLAUDE_ERROR_PATTERNS = [
  {
    pattern: /Not logged in/i,
    message: "Claude CLI authentication required. Run 'claude auth' to log in, or use --mock.",
  },
  {
    pattern: /Please run \/login/i,
    message: "Claude CLI authentication required. Run 'claude auth' to log in, or use --mock.",
  },
  {
    pattern: /API key.*invalid/i,
    message: "Claude CLI API key is invalid. Check your authentication, or use --mock.",
  },
  {
    pattern: /rate limit/i,
    message: "Claude CLI rate limit exceeded. Try again later, or use --mock.",
  },
];

function detectClaudeError(content: string): string | null {
  for (const { pattern, message } of CLAUDE_ERROR_PATTERNS) {
    if (pattern.test(content)) return message;
  }
  return null;
}

function buildStewardPrompt(input: AgentInput): string {
  const contextMd = renderContextPackMarkdown(input.contextPack);
  const transcriptText = input.transcript.map((t) => `${t.participant}: ${t.content}`).join("\n\n");

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
