import type { AgentAdapter, AgentInput, AgentEvent, AdapterConfig } from "@roundtable/core";
import { renderContextPackMarkdown } from "@roundtable/context";
import { tmpDir } from "@roundtable/persistence";
import { mkdir, rm } from "node:fs/promises";
import { spawnCliAgent } from "./cli-agent.js";

/**
 * Prefix buffer size in bytes. Auth/error messages from the Claude CLI appear
 * in the first few hundred bytes. We buffer this much before streaming so that
 * error text is never displayed as participant speech.
 *
 * Caveat: if an error pattern appears *after* the prefix has been flushed and
 * streaming has begun, the user may have already seen partial output. In that
 * case the response_end is still converted to an error event, but the chunks
 * cannot be retracted. This is expected to be rare — auth errors appear
 * immediately, not after 2KB of legitimate output.
 */
const PREFIX_BUFFER_BYTES = 2048;

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

      // Prefix-buffer strategy: hold the first PREFIX_BUFFER_BYTES of stdout
      // to check for auth/error patterns before streaming to the consumer.
      const pendingChunks: AgentEvent[] = [];
      let prefixBytes = 0;
      let prefixText = "";
      let flushed = false;
      let errorDetected = false;

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
          if (errorDetected) {
            // Error already found in prefix — suppress all subsequent chunks
            continue;
          }

          if (!flushed) {
            // Still in prefix-buffering phase
            pendingChunks.push(event);
            prefixBytes += Buffer.byteLength(event.content);
            prefixText += event.content;

            // Check prefix for errors on every chunk
            const authError = detectClaudeError(prefixText);
            if (authError) {
              errorDetected = true;
              continue;
            }

            // Once we've accumulated enough clean prefix, flush and stream
            if (prefixBytes >= PREFIX_BUFFER_BYTES) {
              for (const chunk of pendingChunks) yield chunk;
              pendingChunks.length = 0;
              flushed = true;
            }
          } else {
            // Past prefix — pass through directly
            yield event;
          }
        } else if (event.type === "response_end") {
          // Always check the full content for errors, even after flushing.
          const authError = detectClaudeError(event.content);
          if (authError) {
            yield { type: "error", error: authError, stderr: event.content, exitCode: 0 };
          } else {
            // Flush any remaining buffered chunks (short response < PREFIX_BUFFER_BYTES)
            if (!flushed) {
              for (const chunk of pendingChunks) yield chunk;
            }
            yield event;
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
