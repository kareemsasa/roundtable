import type { AgentAdapter, AgentInput, AgentEvent, AdapterConfig } from "@roundtable/core";
import { renderContextPackMarkdown } from "@roundtable/context";
import { tmpDir } from "@roundtable/persistence";
import { mkdir, rm } from "node:fs/promises";
import { spawnCliAgent } from "./cli-agent.js";

export class CodexAdapter implements AgentAdapter {
  id = "codex";
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

      for await (const event of spawnCliAgent({
        command: this.config.command,
        args: [
          "exec",
          "--sandbox",
          "read-only",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--skip-git-repo-check",
          "--cd",
          cwd,
          "--json",
          "-", // read prompt from stdin
        ],
        cwd,
        timeoutMs: this.config.limits.invocationTimeoutMs,
        maxOutputBytes: this.config.limits.maxOutputBytes,
        gracefulShutdownMs: this.config.limits.gracefulShutdownMs,
        signal,
        stdin: prompt,
      })) {
        if (event.type === "chunk" && event.stream === "stdout") {
          // Suppress raw JSONL stdout chunks from display output.
          // The clean assistant text is extracted in response_end instead.
          continue;
        } else if (event.type === "response_end") {
          const cleaned = extractCodexResponse(event.content);
          yield { ...event, content: cleaned };
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

/**
 * Parse Codex --json JSONL output to extract the actual response text.
 * Codex emits events like:
 *   {"type":"item.completed","item":{"text":"response here"}}
 * We concatenate all item.completed texts.
 */
function extractCodexResponse(rawOutput: string): string {
  const lines = rawOutput.trim().split("\n");
  const texts: string[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === "item.completed" && event.item?.text) {
        texts.push(event.item.text);
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  // If we found structured response text, use it; otherwise fall back to raw output
  return texts.length > 0 ? texts.join("\n") : rawOutput;
}

function buildPrompt(input: AgentInput): string {
  const contextMd = renderContextPackMarkdown(input.contextPack);
  const transcriptText = input.transcript.map((t) => `${t.participant}: ${t.content}`).join("\n\n");

  const parts: string[] = [];

  // Include the system prompt as instructions (Codex exec doesn't have --system-prompt)
  if (input.systemPrompt) {
    parts.push("# Instructions");
    parts.push(input.systemPrompt);
  }

  parts.push("# Context Pack");
  parts.push(contextMd);

  if (input.transcript.length > 0) {
    parts.push("# Transcript");
    parts.push(transcriptText);
  }

  return parts.join("\n\n");
}
