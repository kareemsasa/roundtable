import type { AgentAdapter, AgentInput, AgentEvent, AdapterConfig } from "@roundtable/core";
import { renderContextPackMarkdown } from "@roundtable/context";
import { tmpDir } from "@roundtable/persistence";
import { mkdir, rm } from "node:fs/promises";
import { spawnCliAgent } from "./cli-agent.js";

export class ClaudeAdapter implements AgentAdapter {
  id = "claude";
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
      const prompt = buildPrompt(input);

      // Line buffer for accumulating partial JSONL lines from stdout chunks.
      // Node.js child process data events arrive in arbitrary-sized buffers,
      // not aligned to line boundaries.
      let lineBuffer = "";
      // Accumulated display text from content_block_delta events
      let accumulatedText = "";
      // Clean result text from the final "result" JSONL event
      let resultText: string | undefined;
      // Error detected from the "result" JSONL event
      let resultError: string | undefined;

      for await (const event of spawnCliAgent({
        command: this.config.command,
        args: [
          "--print",
          "--system-prompt",
          input.systemPrompt,
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
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
          // Raw JSONL — buffer and parse line by line
          lineBuffer += event.content;
          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop()!; // keep incomplete last line

          for (const line of lines) {
            const parsed = tryParseJson(line);
            if (!parsed) continue;

            const delta = extractTextDelta(parsed);
            if (delta !== null) {
              accumulatedText += delta;
              yield { type: "chunk", content: delta, stream: "stdout" };
            }

            if (parsed.type === "result") {
              if (parsed.is_error || parsed.subtype !== "success") {
                resultError =
                  (parsed.result as string) || (parsed.error as string) || "Claude CLI error";
              } else {
                resultText = (parsed.result as string) ?? "";
              }
            }
          }
        } else if (event.type === "response_end") {
          // Process any remaining data in the line buffer
          if (lineBuffer.trim()) {
            const parsed = tryParseJson(lineBuffer);
            if (parsed) {
              const delta = extractTextDelta(parsed);
              if (delta !== null) {
                accumulatedText += delta;
                yield { type: "chunk", content: delta, stream: "stdout" };
              }
              if (parsed.type === "result") {
                if (parsed.is_error || parsed.subtype !== "success") {
                  resultError =
                    (parsed.result as string) || (parsed.error as string) || "Claude CLI error";
                } else {
                  resultText = (parsed.result as string) ?? "";
                }
              }
            }
          }

          if (resultError) {
            // Error from the result JSONL event (auth, rate limit, etc.)
            const authError = detectClaudeError(resultError);
            yield {
              type: "error",
              error: authError || resultError,
              stderr: resultError,
              exitCode: 0,
            };
          } else {
            // Determine clean content: result text > accumulated deltas > raw output
            const content = resultText ?? (accumulatedText || event.content);
            const authError = detectClaudeError(content);
            if (authError) {
              yield { type: "error", error: authError, stderr: content, exitCode: 0 };
            } else {
              yield { ...event, content };
            }
          }
        } else {
          yield event;
        }
      }
    } finally {
      // Clean up temp dir
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

/**
 * Try to parse a JSON line. Returns null for empty or invalid lines.
 */
function tryParseJson(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Extract display-safe text from a Claude CLI stream-json event.
 *
 * The relevant event shape for streaming text:
 * ```json
 * {
 *   "type": "stream_event",
 *   "event": {
 *     "type": "content_block_delta",
 *     "index": 0,
 *     "delta": { "type": "text_delta", "text": "..." }
 *   }
 * }
 * ```
 */
function extractTextDelta(parsed: Record<string, unknown>): string | null {
  if (parsed.type !== "stream_event") return null;
  const evt = parsed.event as Record<string, unknown> | undefined;
  if (!evt || evt.type !== "content_block_delta") return null;
  const delta = evt.delta as Record<string, unknown> | undefined;
  if (!delta || delta.type !== "text_delta") return null;
  return typeof delta.text === "string" ? delta.text : null;
}

function buildPrompt(input: AgentInput): string {
  const contextMd = renderContextPackMarkdown(input.contextPack);
  const transcriptText = input.transcript.map((t) => `${t.participant}: ${t.content}`).join("\n\n");

  const parts: string[] = [];
  parts.push("# Context Pack");
  parts.push(contextMd);
  if (input.transcript.length > 0) {
    parts.push("# Transcript");
    parts.push(transcriptText);
  }
  return parts.join("\n\n");
}
